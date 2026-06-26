import { DOMParser } from 'linkedom';

import TurndownService from 'turndown';



/**
 * Extracts all data from html string
 */
export function extract(htmlString, url) {

    let webpageRecord = extractWebpageData(htmlString, url)

    webpageRecord.text = extractMarkdown(htmlString)

    webpageRecord.about = extractSchemaData(htmlString)?.jsonLD || []

    webpageRecord.hasPart = extractContactData(htmlString, webpageRecord?.name || 'Target Entity')

    webpageRecord.hasPart = webpageRecord.hasPart.concat(extractNavigationLinks(htmlString, url))

    return webpageRecord

}


/**
 * Converts HTML to Markdown while stripping out menus and non-content elements.
 * @param {string} htmlString - The raw HTML content.
 * @param {Array<string>} extraSelectorsToRemove - Optional custom CSS selectors to remove (e.g., ['.my-custom-menu-class'])
 * @returns {string} Cleaned Markdown string.
 */
function extractMarkdown(htmlString, extraSelectorsToRemove = []) {
    if (!htmlString) return '';

    const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced'
    });

    // 1. Standard structural elements to entirely strip out
    const defaultElementsToRemove = [
        'script', 'style', 'noscript', 'iframe',
        'nav', 'header', 'footer', 'aside'
    ];

    // 2. Add a custom rule to drop elements based on common menu/nav CSS classes and IDs
    turndownService.addRule('removeMenusAndSidebars', {
        filter: function (node) {
            // Check HTML tag names
            if (defaultElementsToRemove.includes(node.nodeName.toLowerCase())) {
                return true;
            }

            // Check custom user-defined selectors
            if (extraSelectorsToRemove.some(selector => node.matches?.(selector))) {
                return true;
            }

            // Check common class names/IDs for menus, sidebars, and popups
            const classAndIdString = `${node.className} ${node.id}`.toLowerCase();
            const noiseKeywords = [
                'menu', 'navigation', 'navbar', 'sidebar', 'footer', 
                'header', 'popup', 'modal', 'cookie-banner', 'widget', 
                'social-share', 'breadcrumbs'
            ];

            return noiseKeywords.some(keyword => classAndIdString.includes(keyword));
        },
        replacement: function () {
            // Returning an empty string completely erases the element from the output
            return ''; 
        }
    });

    return turndownService.turndown(htmlString);
}


export function extractSchemaData(htmlString) {
    const results = { jsonLD: [], microdata: [] };
    if (!htmlString) return results;

    // Use linkedom's parser exactly like the browser version
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    // 1. Extract JSON-LD
    const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
    jsonLdScripts.forEach(script => {
        try {
            results.jsonLD.push(JSON.parse(script.textContent.trim()));
        } catch (e) {
            console.error('Failed to parse JSON-LD:', e.message);
        }
    });

    // 2. Extract Microdata
    const itemScopes = doc.querySelectorAll('[itemscope]');
    itemScopes.forEach(item => {
        if (item.parentElement && item.parentElement.closest('[itemscope]')) return;

        const itemType = item.getAttribute('itemtype');
        const schemaObject = {
            '@context': 'https://schema.org',
            '@type': itemType ? itemType.split('/').pop() : 'Unknown',
            'properties': {}
        };

        const properties = item.querySelectorAll('[itemprop]');
        properties.forEach(prop => {
            const propName = prop.getAttribute('itemprop');
            let propValue = prop.content || prop.textContent.trim();
            
            if (prop.tagName === 'A' || prop.tagName === 'LINK') propValue = prop.getAttribute('href');
            else if (prop.tagName === 'IMG') propValue = prop.getAttribute('src');
            else if (prop.tagName === 'META') propValue = prop.getAttribute('content');

            if (schemaObject.properties[propName]) {
                if (!Array.isArray(schemaObject.properties[propName])) {
                    schemaObject.properties[propName] = [schemaObject.properties[propName]];
                }
                schemaObject.properties[propName].push(propValue);
            } else {
                schemaObject.properties[propName] = propValue;
            }
        });

        results.microdata.push(schemaObject);
    });

    return results;
}


/**
 * Parses an HTML string using linkedom and generates a Schema.org WebPage record.
 * @param {string} htmlString - The raw HTML content.
 * @param {string} pageUrl - The URL of the page (required for Schema IDs).
 * @returns {Object} A Schema.org WebPage JSON-LD object.
 */
export function extractWebpageData(htmlString, pageUrl = 'https://example.com') {
    if (!htmlString) return null;

    // Initialize linkedom's DOMParser
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    // Helper helper to safely get meta tags
    const getMetaContent = (selector) => {
        const element = doc.querySelector(selector);
        return element ? element.getAttribute('content') : null;
    };

    // 1. Core Metadata Extraction
    const titleEl = doc.querySelector('title');
    const h1El = doc.querySelector('h1');
    const title = (titleEl ? titleEl.textContent : '') || (h1El ? h1El.textContent : '').trim();
    
    const description = getMetaContent('meta[name="description"]') || 
                        getMetaContent('meta[property="og:description"]') || '';

    // 2. Headings Hierarchy Extraction
    const h1s = Array.from(doc.querySelectorAll('h1')).map(el => el.textContent.trim());
    const h2s = Array.from(doc.querySelectorAll('h2')).map(el => el.textContent.trim());

    // 3. Image Extraction
    const images = [];
    const imgElements = doc.querySelectorAll('img');
    imgElements.forEach(img => {
        const src = img.getAttribute('src');
        const alt = img.getAttribute('alt') || '';
        // Skip tracking pixels or empty sources
        if (src && !src.startsWith('data:')) {
            images.push({
                '@type': 'ImageObject',
                'url': new URL(src, pageUrl).href,
                'caption': alt
            });
        }
    });

    // 4. Extract global readable text snippet (paragraph aggregation)
    const paragraphs = Array.from(doc.querySelectorAll('p'))
        .map(el => el.textContent.trim())
        .filter(text => text.length > 0)
        .join(' ');
    const textExcerpt = paragraphs.slice(0, 500) + (paragraphs.length > 500 ? '...' : '');

    // 5. Construct the final Schema.org WebPage Object
    const webPageSchema = {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        '@id': `${pageUrl}#webpage`,
        'url': pageUrl,
        'name': title,
        'description': description,
        'headline': h1s[0] || title,
        'alternativeHeadline': h2s.slice(0, 3).join(', ') || undefined,
        'image': images.slice(0, 5), // Cap at top 5 images
        'mainEntity': {
            '@type': 'CreativeWork',
            'name': h1s[0] || title,
            'text': textExcerpt || undefined
        }
    };

    // Strip out undefined fields cleanly
    return JSON.parse(JSON.stringify(webPageSchema));
}





/**
 * Extracts emails, phones, and social links from HTML and formats them as a Schema.org Organization.
 * @param {string} htmlString - The raw HTML content.
 * @param {string} entityName - The fallback name of the company/person if not found in HTML.
 * @returns {Object} Schema.org JSON-LD object containing only contact info.
 */
export function extractContactData(htmlString, entityName = "Target Entity") {
    if (!htmlString) return null;

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    const emails = new Set();
    const phones = new Set();
    const socialLinks = new Set();

    // 1. Scan links for mailto, tel, and social domains
    const links = doc.querySelectorAll('a');
    links.forEach(link => {
        const href = link.getAttribute('href')?.trim();
        if (!href) return;

        if (href.startsWith('mailto:')) {
            const email = href.replace('mailto:', '').split('?')[0].trim();
            if (email) emails.add(email);
            return;
        }

        if (href.startsWith('tel:')) {
            const phone = href.replace('tel:', '').trim();
            if (phone) phones.add(phone);
            return;
        }

        // Detect social media links
        try {
            const url = new URL(href);
            const host = url.hostname.replace('www.', '');
            const socialDomains = ['linkedin.com', 'twitter.com', 'x.com', 'facebook.com', 'instagram.com', 'youtube.com', 'github.com'];
            
            if (socialDomains.some(domain => host.includes(domain))) {
                socialLinks.add(href);
            }
        } catch (e) {
            // Ignore relative links or parsing errors
        }
    });

    // 2. Plain text fallback scan for emails
    const bodyText = doc.body ? doc.body.textContent : '';
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    (bodyText.match(emailRegex) || []).forEach(email => emails.add(email.toLowerCase()));

    // Try to grab a better entity name from the <title> tag if available
    const titleEl = doc.querySelector('title');
    const dynamicName = titleEl ? titleEl.textContent.split('|')[0].trim() : entityName;

    // 3. Build the Schema.org payload
    const contactPoints = Array.from(phones).map(phone => ({
        '@type': 'ContactPoint',
        'telephone': phone,
        'contactType': 'customer service' // Standard fallback type
    }));

    const schemaJson = {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        'name': dynamicName,
        // If emails exist, provide the primary one at the root
        'email': Array.from(emails)[0] || undefined, 
        // List of all distinct phone numbers formatted as ContactPoints
        'contactPoint': contactPoints.length > 0 ? contactPoints : undefined,
        // List of all matching social profiles
        'sameAs': socialLinks.size > 0 ? Array.from(socialLinks) : undefined
    };

    // Clean up undefined properties
    return JSON.parse(JSON.stringify(schemaJson));
}



/**
 * Extracts header and footer links from HTML and structures them into a Schema.org WebPage record.
 * @param {string} htmlString - The raw HTML content.
 * @param {string} pageUrl - The canonical URL of the page being scraped.
 * @returns {Object} Schema.org WebPage JSON-LD object.
 */
export function extractNavigationLinks(htmlString, pageUrl = 'https://example.com') {
    if (!htmlString) return null;

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    // Handle potential <base> tag override for relative URLs
    const baseElement = doc.querySelector('base[href]');
    const activeBaseUrl = baseElement ? baseElement.getAttribute('href') : pageUrl;

    // Helper to safely extract links from a specific container element
    const getLinksFromContainer = (container) => {
        if (!container) return [];
        const links = [];
        
        container.querySelectorAll('a').forEach(anchor => {
            const href = anchor.getAttribute('href')?.trim();
            const text = anchor.textContent.trim();
            
            if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
                try {
                    // Resolve relative links automatically using the native URL API
                    const absoluteUrl = new URL(href, activeBaseUrl).href;
                    links.push({
                        '@type': 'SiteNavigationElement',
                        'name': text || 'Link',
                        'url': absoluteUrl
                    });
                } catch (e) {
                    // Skip malformed URLs
                }
            }
        });
        return links;
    };

    // 1. Target Header Container (Semantic tag fallback to class names)
    const headerElement = doc.querySelector('header') || 
                          doc.querySelector('[class*="header" i]') || 
                          doc.querySelector('[id*="header" i]');
    const headerLinks = getLinksFromContainer(headerElement);

    // 2. Target Footer Container (Semantic tag fallback to class names)
    const footerElement = doc.querySelector('footer') || 
                          doc.querySelector('[class*="footer" i]') || 
                          doc.querySelector('[id*="footer" i]');
    const footerLinks = getLinksFromContainer(footerElement);

    // Try to pull a page title
    const title = doc.querySelector('title')?.textContent.trim() || 'Web Page';

    // 3. Assemble the WebPage JSON-LD Schema
    const webPageSchema = {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        '@id': `${pageUrl}#webpage`,
        'url': pageUrl,
        'name': title,
        'hasPart': []
    };
    let links = []

    // Only add structural parts if links were actually found
    if (headerLinks.length > 0) {
        links.push({
            '@type': 'WPHeader',
            '@id': `${pageUrl}#header`,
            'name': 'Main Navigation Header',
            'hasPart': headerLinks
        });
    }

    if (footerLinks.length > 0) {
        links.push({
            '@type': 'WPFooter',
            '@id': `${pageUrl}#footer`,
            'name': 'Page Footer Navigation',
            'hasPart': footerLinks
        });
    }

    return links;
}




/**
 * Extracts all tables from an HTML string and converts them into structured JSON objects.
 * @param {string} htmlString - The raw HTML content.
 * @returns {Array<Array<Object>>} An array of tables, where each table is an array of row objects.
 */
export function extractTables(htmlString) {
    if (!htmlString) return [];

    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');
    const extractedTables = [];

    const tables = doc.querySelectorAll('table');

    tables.forEach((table, tableIndex) => {
        const rows = Array.from(table.querySelectorAll('tr'));
        if (rows.length === 0) return;

        // 1. Identify Headers
        // Look inside <thead> first, or fall back to the first row's <th>/<td> tags
        const headRow = table.querySelector('thead tr') || rows[0];
        let headers = Array.from(headRow.querySelectorAll('th, td')).map(el => el.textContent.trim());

        // If the first row was used as headers, slice the data rows to skip it
        const startDataIdx = (headRow === rows[0]) ? 1 : 0;
        const dataRows = (table.querySelector('tbody') ? Array.from(table.querySelectorAll('tbody tr')) : rows).slice(startDataIdx);

        const tableData = [];

        // 2. Map data rows to header keys
        dataRows.forEach(row => {
            const cells = Array.from(row.querySelectorAll('td, th'));
            if (cells.length === 0) return; // Skip empty structural rows

            const rowObject = {};
            
            // Iterate through headers to match with column values
            headers.forEach((header, index) => {
                const cellValue = cells[index] ? cells[index].textContent.trim() : '';
                // Fallback key if the HTML table header row was empty or missing columns
                const key = header || `column_${index + 1}`;
                rowObject[key] = cellValue;
            });

            tableData.push(rowObject);
        });

        if (tableData.length > 0) {
            extractedTables.push(tableData);
        }
    });

    return extractedTables;
}



/**
 * Extracts only the dense, main textual content blocks from a webpage.
 * @param {string} htmlString 
 * @returns {string} Cleaned, readable text body.
 */
export function extractMainContentText(htmlString) {
    const doc = new DOMParser().parseFromString(htmlString, 'text/html');
    
    // Remove known structural noise before analyzing density
    doc.querySelectorAll('script, style, nav, footer, header, aside, form').forEach(el => el.remove());

    const contentParagraphs = [];
    
    // Scan structural content blocks
    doc.querySelectorAll('p, div, article').forEach(block => {
        const text = block.textContent.trim();
        if (text.length < 30) return; // Skip short snippets (share buttons, dates)

        // Calculate Link Density: text length inside links vs total text length
        const totalLength = text.length;
        let linkLength = 0;
        block.querySelectorAll('a').forEach(a => linkLength += a.textContent.trim().length);
        
        const linkDensity = linkLength / totalLength;

        // If less than 20% of the block's text consists of links, it's likely real content
        if (linkDensity < 0.20 && block.tagName === 'P') {
            contentParagraphs.push(text);
        }
    });

    return [...new Set(contentParagraphs)].join('\n\n');
}


/**
 * Extracts SEO Meta, OpenGraph, and Twitter card tracking tokens.
 */
export function extractSeoMetadata(htmlString) {
    const doc = new DOMParser().parseFromString(htmlString, 'text/html');
    const metadata = {};

    doc.querySelectorAll('meta').forEach(meta => {
        const key = meta.getAttribute('property') || meta.getAttribute('name');
        const value = meta.getAttribute('content');

        if (key && value) {
            if (key.startsWith('og:') || key.startsWith('twitter:') || ['description', 'keywords', 'robots'].includes(key)) {
                metadata[key] = value;
            }
        }
    });

    metadata['canonical'] = doc.querySelector('link[rel="canonical"]')?.getAttribute('href') || null;
    return metadata;
}
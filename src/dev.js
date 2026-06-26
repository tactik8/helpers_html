
import { _html } from './index.js'

async function test(){


    let url = 'https://www.mondou.com/fr-CA/nourriture-seche-recette-au-poulet-frais-eleve-en-liberte-et-merlu-cru-pour-chiens-adultes-de-grande-race-17-kg-1043465.html'

    //let url ='https://www.mondou.com/fr-CA/chien/nourriture/nourriture-seche/'
    
    
    let r = await fetch(url)

    let htmlContent = await r.text()

    let record = _html.extractNavigationLinks(htmlContent, url)

    console.log('record', JSON.stringify(record, null, 4))

    

}

await test()

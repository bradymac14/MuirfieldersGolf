
// api/calculate.js
export default async function handler(req, res) {
  try {
    const response = await fetch('https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard');
    const data = await response.json();
    
    // This calls your math function
    const results = processPrizeMoney(data); 

    // This makes sure the result is cached for 10 seconds
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate');
    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch or process' });
  }
}

// NOTE: You must also include the processPrizeMoney function here
function processPrizeMoney(data) {
    // Paste your existing logic here!
}

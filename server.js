const axios = require('axios');
const cheerio = require('cheerio');
const { RateLimiterMemory } = require('rate-limiter-flexible');

// Config
const site = {
  name: 'Economic Times',
  baseUrl: 'https://economictimes.indiatimes.com',
  section: '/markets'
};
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
const threeDaysAgo = new Date();
threeDaysAgo.setDate(threeDaysAgo.getDate() - 3); // Last 3 days
const threeDaysAgoStr = threeDaysAgo.toISOString().split('T')[0]; // YYYY-MM-DD
console.log(`Filtering articles from ${threeDaysAgoStr} to today (${new Date().toISOString().split('T')[0]})`);

// Rate limiter: 1 request per second
const rateLimiter = new RateLimiterMemory({
  points: 1,
  duration: 1,
});

// Fetch and parse HTML
async function fetchPage(url, retries = 2) {
  try {
    await rateLimiter.consume(url);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      timeout: 10000,
    });
    return cheerio.load(response.data);
  } catch (error) {
    if (retries > 0 && error.response?.status === 403) {
      console.warn(`Retrying ${url} (${retries} attempts left)...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return fetchPage(url, retries - 1);
    }
    console.error(`Error fetching ${url}: ${error.message}`);
    return null;
  }
}

// Extract article links
async function getArticleLinks() {
  const sectionUrl = site.baseUrl + site.section;
  console.log(`Crawling ${site.name} at ${sectionUrl}...`);
  const $ = await fetchPage(sectionUrl);
  if (!$) return [];

  const links = [];
  const selectors = '.eachStory a, .story-list a, a[href*="/articleshow/"], a[href*="/news/"], a[href*="/markets/"]';
  $(selectors).each((i, el) => {
    let link = $(el).attr('href');
    if (link && !link.startsWith('http')) link = site.baseUrl + link;
    if (link && !links.includes(link) && link.startsWith('http') && link.includes('economictimes.indiatimes.com')) {
      links.push(link);
    }
  });

  console.log(`Found ${links.length} article links`);
  return links.slice(0, 15); // Limit for testing
}

// Check article
async function checkArticle(url) {
  console.log(`Checking article: ${url}`);
  const $ = await fetchPage(url);
  if (!$) return null;

  // Extract title
  const title = $('title').text().trim() || $('h1').first().text().trim() || 'No title';

  // Extract publish date (try multiple selectors)
  let rawDate = $('meta[property="article:published_time"]').attr('content') ||
                $('meta[name="publish-date"]').attr('content') ||
                $('time').attr('datetime') ||
                $('.date').text().trim() ||
                $('.timestamp, .timeStamp, .pubtime').text().trim() ||
                $('.article-date, .story-date').text().trim();
  let pubDate = null;
  if (rawDate) {
    try {
      pubDate = new Date(rawDate);
      if (!isNaN(pubDate)) {
        pubDate = pubDate.toISOString().split('T')[0];
      } else {
        pubDate = null;
      }
    } catch (e) {
      console.warn(`Invalid date format for ${url}: ${rawDate}`);
      pubDate = null;
    }
  }

  console.log(`Raw date: ${rawDate}, Parsed date: ${pubDate}`);

  // Extract content snippet
  const content = $('article, .content, .story-body, .artText, p, .articleBody').text().trim().slice(0, 500);

  // Include article if it has a valid date in the last 3 days or no date (for testing)
  if (pubDate && pubDate >= threeDaysAgoStr || !pubDate) {
    return {
      title,
      url,
      pubDate: pubDate || 'Unknown',
      snippet: content.slice(0, 200) + '...'
    };
  }
  return null;
}

// Main crawler
async function crawlFinanceNews() {
  const results = [];
  const links = await getArticleLinks();
  for (const link of links) {
    const article = await checkArticle(link);
    if (article) results.push({ site: site.name, ...article });
  }
  return results;
}

// Run
crawlFinanceNews()
  .then(results => {
    console.log(`Found ${results.length} articles from the last 3 days:`);
    console.log(JSON.stringify(results, null, 2));
  })
  .catch(error => console.error('Crawler error:', error));
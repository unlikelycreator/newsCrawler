const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { RateLimiterMemory } = require('rate-limiter-flexible');

const app = express();
const port = 10000;

// Config
const site = {
  name: 'Economic Times',
  baseUrl: 'https://economictimes.indiatimes.com',
  section: '/markets/stocks/news' // Narrowed to news section
};
const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
const threeDaysAgo = new Date();
threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
const threeDaysAgoStr = threeDaysAgo.toISOString().split('T')[0];

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
  const $ = await fetchPage(sectionUrl);
  if (!$) return [];

  const links = [];
  const selectors = 'a[href*="/articleshow/"]'; // Focus on article pages
  $(selectors).each((i, el) => {
    let link = $(el).attr('href');
    if (link && !link.startsWith('http')) link = site.baseUrl + link;
    // Exclude non-article pages
    if (
      link &&
      !links.includes(link) &&
      link.startsWith('http') &&
      link.includes('economictimes.indiatimes.com') &&
      !link.includes('/liveblog') &&
      !link.includes('/stock-screener') &&
      !link.includes('/live-coverage') &&
      !link.includes('/etmarkets-podcasts') &&
      !link.includes('/earnings') &&
      !link.includes('/recos') &&
      !link.includes('/stockreportsplus')
    ) {
      links.push(link);
    }
  });

  console.log(`Found ${links.length} article links`);
  return links.slice(0, 10); // Limit for speed
}

// Check article
async function checkArticle(url) {
  const $ = await fetchPage(url);
  if (!$) return null;

  // Extract title
  const title = $('title').text().trim() || $('h1').first().text().trim() || 'No title';

  // Extract publish date
  let rawDate = $('meta[property="article:published_time"]').attr('content') ||
                $('meta[name="publish-date"]').attr('content') ||
                $('time').attr('datetime') ||
                $('.date, .pub_time, .timeStamp, .pubtime, .article-date, .story-date').text().trim();
  let pubDate = null;
  if (rawDate) {
    try {
      // Handle formats like "Aug 31, 2025, 10:00 AM IST"
      if (!rawDate.includes('T') && rawDate.includes(',')) {
        rawDate = rawDate.replace(/IST/, '').trim();
      }
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

  // Extract content snippet
  const content = $('article, .content, .story-body, .artText, .articleBody, p').text().trim().slice(0, 500);

  // Include article if valid date in last 3 days or no date
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

// Crawler
async function crawlFinanceNews() {
  const results = [];
  const links = await getArticleLinks();
  for (const link of links) {
    const article = await checkArticle(link);
    if (article) results.push({ site: site.name, ...article });
  }
  return results;
}

// API endpoint
app.get('/news', async (req, res) => {
  try {
    const articles = await crawlFinanceNews();
    res.json({
      status: 'success',
      count: articles.length,
      dateRange: {
        from: threeDaysAgoStr,
        to: new Date().toISOString().split('T')[0]
      },
      articles
    });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch news',
      error: error.message
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
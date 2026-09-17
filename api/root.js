const PREVIEW_URL = 'https://www.bluvixa.com/bluvixa-business-card-share-v6.jpg';

function socialMeta() {
  return `
<link rel="canonical" href="https://www.bluvixa.com/">
<meta property="og:type" content="website">
<meta property="og:title" content="Bluvixa 4.0 — Website Builder">
<meta property="og:description" content="Build your own professional website with Bluvixa.">
<meta property="og:url" content="https://www.bluvixa.com/">
<meta property="og:site_name" content="Bluvixa">
<meta property="og:image" content="${PREVIEW_URL}">
<meta property="og:image:url" content="${PREVIEW_URL}">
<meta property="og:image:secure_url" content="${PREVIEW_URL}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="600">
<meta property="og:image:height" content="315">
<meta property="og:image:alt" content="Bluvixa web design business card">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Bluvixa 4.0 — Website Builder">
<meta name="twitter:description" content="Build your own professional website with Bluvixa.">
<meta name="twitter:image" content="${PREVIEW_URL}">
`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).end('Method Not Allowed');
  }

  const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || 'www.bluvixa.com')
    .split(',')[0]
    .trim();
  const host = forwardedHost || 'www.bluvixa.com';
  const sourceUrl = `https://${host}/index.html`;

  try {
    const upstream = await fetch(sourceUrl, {
      redirect: 'follow',
      headers: {
        'user-agent': 'Bluvixa-Root-Renderer/1.0',
        accept: 'text/html,application/xhtml+xml'
      }
    });

    if (!upstream.ok) {
      throw new Error(`index.html returned ${upstream.status}`);
    }

    let html = await upstream.text();
    if (!html.includes('</head>')) {
      throw new Error('index.html is missing </head>');
    }

    html = html.replace('</head>', `${socialMeta()}\n</head>`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=600');
    res.setHeader('X-Bluvixa-Social-Meta', 'v6');

    if (req.method === 'HEAD') {
      return res.status(200).end();
    }

    return res.status(200).send(html);
  } catch (error) {
    console.error('Bluvixa root renderer failed:', error);
    res.setHeader('Cache-Control', 'no-store');
    return res.redirect(307, '/index.html');
  }
};

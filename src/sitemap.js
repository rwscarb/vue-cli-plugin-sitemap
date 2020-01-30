
/**
 * src/sitemap.js
 */

const { ajv, slugsValidator } = require('./validation');

const MAX_NB_URLS = 50000;

/**
 * Generate one or more sitemaps, and an accompanying sitemap index if needed
 * Return an object of text blobs to save to different files ([filename]: [contents])
 */
async function generateSitemaps(options)
{
	// If a base URL is specified, make sure it ends with a slash
	const baseURL = options.baseURL ? `${options.baseURL.replace(/\/+$/, '')}/` : '';

	const urls = [...options.urls, ...await generateURLsFromRoutes(options.routes)]
		// Generate the location of each URL
		.map(url => ({ ...url, loc: escapeUrl(baseURL + url.loc.replace(/^\//, '')).replace(/\/$/, '') + (options.trailingSlash ? '/' : '') }))
		// Remove duplicate URLs (static URLs have preference over routes)
		.filter((url, index, urls) => !('path' in url) || urls.every((url, index) => (url.loc != url.loc || index == index)));

	let blobs    = {};
	let sitemaps = [urls];

	// If there is more than 50,000 URLs, split them into several sitemaps
	if (urls.length > MAX_NB_URLS)
	{
		sitemaps = [];
		const nb_sitemaps = Math.ceil(urls.length / MAX_NB_URLS);

		// Split the URLs into batches of 50,000
		for (let i=0; i<nb_sitemaps; i++)
			sitemaps.push(urls.slice(i*MAX_NB_URLS, (i+1)*MAX_NB_URLS));

		// Generate the sitemap index
		blobs['sitemap-index'] = await generateSitemapIndexXML(nb_sitemaps, options);
	}

	// Generate the sitemaps
	await Promise.all(sitemaps.map(async function(urls, index, sitemaps)
	{
		const filename  = (sitemaps.length > 1)
		                ? `sitemap-${index.toString().padStart(sitemaps.length.toString().length, '0')}`
		                : 'sitemap'

		blobs[filename] = await generateSitemapXML(urls, options);
	}));

	return blobs;
}

async function generateSitemapIndexXML(nbSitemaps, options)
{
	const sitemaps = [...new Array(nbSitemaps).keys()]
		.map(function(index)
		{
			const filename = `sitemap-${index.toString().padStart(nbSitemaps.toString().length, '0')}.xml`;

			return '\t<sitemap>\n'
			     +     `\t\t<loc>${options.baseURL.replace(/\/$/, '')}/${filename}</loc>\n`
			     + '\t</sitemap>\n'
		});

	return '<?xml version="1.0" encoding="UTF-8"?>\n'
	     + '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
	     +     sitemaps.join('')
	     + '</sitemapindex>';
}

async function generateSitemapXML(urls, options)
{
	return '<?xml version="1.0" encoding="UTF-8"?>\n'
	     + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
	     +     `${urls.map(url => generateURLTag(url, options)).join('')}`
	     + '</urlset>';
}

function generateURLTag(url, options)
{
	const metaTags = ['lastmod', 'changefreq', 'priority'].map(function(tag)
	{
		if (tag in url == false && tag in options.defaults == false)
			return '';

		let value = (tag in url) ? url[tag] : options.defaults[tag];

		// Fix the bug of whole-number priorities
		if (tag == 'priority')
		{
			if (value == 0) value = '0.0';
			if (value == 1) value = '1.0';
		}

		return `\t\t<${tag}>${value}</${tag}>\n`;
	});

	return `\t<url>\n\t\t<loc>${url.loc}</loc>\n${metaTags.join('')}\t</url>\n`;
}

function escapeUrl(url)
{
	return encodeURI(url)
		.replace('&',  '&amp;')
		.replace("'", '&apos;')
		.replace('"', '&quot;')
		.replace('<',   '&lt;')
		.replace('>',   '&gt;');
}

async function generateURLsFromRoutes(routes)
{
	let urls = [];

	for (const route of routes)
	{
		// Merge the properties located directly in the
		// route object and those in the 'sitemap' sub-property
		const url = { ...route, ...route.sitemap };

		if (url.ignoreRoute) continue;

		/**
		 * Static URLs
		 */
		if ('loc' in url)
		{
			urls.push(url);
			continue;
		}

		/**
		 * Static routes
		 */

		// Ignore the "catch-all" 404 route
		if (route.path == '*') continue;

		// Remove a potential slash at the beginning of the path
		const path = route.path.replace(/^\/+/, '');

		// For static routes, simply prepend the base URL to the path
		if (!route.path.includes(':'))
		{
			urls.push({ loc: path, ...url });
			continue;
		}

		/**
		 * Dynamic routes
		 */

		// Ignore dynamic routes if no slugs are provided
		if (!url.slugs) continue;

		// Get the name of the dynamic parameter
		const param = route.path.match(/:\w+/)[0];

		// If the 'slug' property is a generator, execute it
		const slugs = await (typeof url.slugs == 'function' ? url.slugs.call() : url.slugs);

		// Check the validity of the slugs
		if (!slugsValidator(slugs))
			throw new Error(`[vue-cli-plugin-sitemap]: ${ajv.errorsText(slugsValidator.errors).replace(/^data/, 'slugs')}`);

		// Build the array of URLs
		urls = urls.concat(
			[...new Set(slugs)].map(function(slug)
			{
				// If the slug is an object (slug + additional meta tags)
				if (Object.prototype.toString.call(slug) == '[object Object]')
					return { loc: path.replace(param, slug.slug), ...url, ...slug };

				// Else if the slug is just a simple value
				return { loc: path.replace(param, slug), ...url }
			})
		);
	}

	return urls;
}

module.exports = generateSitemaps;

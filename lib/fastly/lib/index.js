/**
 * Fastly API client.
 *
 * @package fastly
 * @author Andrew Sliwinski <andrew@diy.org>
 */

/**
 * Dependencies
 */
const request = require('request');
const debug = require('debug')('fastly');

/**
 * Constructor
 */
function Fastly (apikeys, service, options) {

	var opts = options || {};
	apikeys = apikeys || [];
	this.apikey = apikeys.shift();
	this.apikeys = apikeys || [];

	this.service = service || '';
	this.verbose = (opts.verbose) ? true : false;
	this.useragent = (opts.useragent) ? opts.useragent : 'fastly-tools';

	var self = this;

	// For each API method create a function
	require('./api').forEach(function (a) {
		if (a.fn && (a.fn !== '')) {

			self[a.fn] = function () {

				var url = a.url;
				var method = a.method;

				var interpolateUrl = function (url, tokens) {
					return url
							.split('/')
							.map( function (a) {
								return /^\%/.test(a) ? tokens.pop() : a; // pop. not idempotent.
							})
							.join('/');
				};

				var args = [].slice.call(arguments).reverse().concat([self.service]);

				// In the cases where we want a POST body we pass the
				// parameters as the last argument, so after the arguments have
				// been converted to an array and reversed we can detect an
				// object has been passed in an unshift it.
				var params = (args[0] && typeof args[0] === 'object') ? args.shift() : null;

				var endPoint = interpolateUrl(url, args);

				return self.request(method, endPoint, params)
			};
		}
	});
}

/**
 * Adapter helper method.
 *
 * @param {string} Method
 * @param {string} URL
 * @param {params} Optional params to update.
 *
 * @return {Object}
 */
Fastly.prototype.request = function (method, url, params) {

	return new Promise((resolve, reject) => {
		// Allow for optional update params.
		if (typeof params === 'function') {
			params = null;
		}

		debug('Request: ' + method + ', ' + url);

		// Construct headers
		var headers = {
			'fastly-key': this.apikey,
			'User-Agent': this.useragent
		};

		// Force TLS 1.2 in request
		// https://www.npmjs.com/package/request
		// https://nodejs.org/api/tls.html#tls_tls_connect_options_callback
		// https://www.openssl.org/docs/man1.0.2/ssl/ssl.html#DEALING-WITH-PROTOCOL-METHODS
		var agentOptions = {
			secureProtocol: 'TLSv1_2_method'
		};

		// HTTP request
		const options = {
			headers: headers,
			agentOptions: agentOptions,
			method: method,
			url: 'https://api.fastly.com' + url,
			form: params
		};

		request(options, (err, response, body) => {

			if (err || ! response) {
				return reject(body);
			}

			if (this.verbose) {
				debug('Response: ' + response.statusCode + ' ' + body);
			}

			if (response.statusCode >= 400) return reject(body);
			if (response.statusCode > 302) return resolve(body);
			if (response.headers['content-type'] === 'application/json') {
				try {
					body = JSON.parse(body);
				} catch (error) {
					return reject(error);
				}
			}
			console.log(method.toUpperCase() + ' to  ' + url + ' succeeded');
			resolve(body);
		});
	})
	.catch(err => {
		if (err.msg && /You have exceeded your hourly rate limit/.test(err.msg) && this.apikeys.length) {
			console.log(method.toUpperCase() + ' to  ' + url + ' hit rate limit');
			this.apikey = this.apikeys.shift();
			if (!this.apikey) {
				console.log('no backup api keys available');
				throw err;
			}
			return this.request(method, url, params)
		} else {
			console.log('Unknown error:' + err);
		}
		console.log(method.toUpperCase() + ' to  ' + url + ' failed');
		throw err;
	});

};

// -------------------------------------------------------

Fastly.prototype.purge = function (host, url) {
	return this.request('POST', '/purge/' + host + url);
};

Fastly.prototype.purgeAll = function (service) {
	var url = '/service/' + encodeURIComponent(service) + '/purge_all';
	return this.request('POST', url);
};

Fastly.prototype.purgeKey = function (service, key) {
	var url = '/service/' + encodeURIComponent(service) + '/purge/' + key;
	return this.request('POST', url);
};

Fastly.prototype.stats = function (service) {
	var url = '/service/' + encodeURIComponent(service) + '/stats/summary';
	return this.request('GET', url);
};

Fastly.prototype.stats = function (service) {
	var url = '/service/' + encodeURIComponent(service) + '/stats/summary';
	return this.request('GET', url);
};

/**
 * Export
 */
module.exports = function (apikey, service, opts) {
	return new Fastly(apikey, service, opts);
};

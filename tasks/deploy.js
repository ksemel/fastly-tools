'use strict';
const co = require('co');
require('array.prototype.includes');
const path = require('path');
const prompt = require('prompt');

const loadVcl = require('../lib/loadVcl');
const symbols = require('../lib/symbols');

function task (folders, opts) {
	let options = Object.assign({
		main: 'main.vcl',
		env: false,
		service: null,
		vars: [],
		verbose: false,
		autoactivate: false,
		disableLogs: false,
		backends: null,
		apiKeys: [],
		skipConditions: [],
		skipResponses: [],
		skipDomains: [],
		folders: [],
		protected: []
	}, opts);

	if (options.env) {
		require('dotenv').load();
	}

	folders = options.folders;

	const log = require('../lib/logger')({verbose:options.verbose, disabled:options.disableLogs});

	return co(function*() {
		if (!folders) {
			throw new Error('Please provide a folder(s) where the .vcl is located');
		}

		if (!options.service) {
			throw new Error('the service parameter is required set to the service id of a environment variable name');
		}

		if (process.env.FASTLY_APIKEY) {
			options.apiKeys.unshift(process.env.FASTLY_APIKEY);
		}

		if (!options.apiKeys.length) {
			throw new Error('fastly api key not found. Either set a FASTLY_APIKEY environment variable, or pass in using the --api-keys option');
		}

		const fastlyApiKeys = options.apiKeys;
		const serviceId = process.env[opts.service] || opts.service;

		if (!serviceId) {
			throw new Error('No service ');
		}

		const fastly = require('./../lib/fastly/lib')(fastlyApiKeys, encodeURIComponent(serviceId), {verbose: false});

		// if service ID is needed use the given serviceId
		if (options.vars.includes('SERVICEID')) {
			process.env.SERVICEID = serviceId;
		}

		const vcls = loadVcl(folders, options.vars, log);

		// get the current service and active version
		const service = yield fastly.getServices().then(services => services.find(s => s.id === serviceId));
		const activeVersion = service.version;

		// clone new version from current active version
		log.verbose(`Cloning active version ${activeVersion} of ${service.name}`);
		let cloneResponse = yield fastly.cloneVersion(activeVersion);
		log.verbose(`Successfully cloned version ${cloneResponse.number}`);
		let newVersion = cloneResponse.number;
		log.info('Cloned new version');

		//upload backends via the api
		if(options.backends){
			log.verbose(`Backends option specified.  Loading backends from ${options.backends}`);
			const backendData = require(path.join(process.cwd(), options.backends));

			// Domains
			if (backendData.domains) {
				// delete old domains
				let currentDomains = yield fastly.getDomains(newVersion);
				yield Promise.all(currentDomains.map(domain => {
					if (options.skipDomains.some(function(c) { return domain.name.indexOf(c) >= 0; })) {
						log.verbose(`  Skipping protected domain "${domain.name}" for version ${newVersion}`);
						return;
					} else {
						log.verbose(`  Deleting "${domain.name}" for version ${newVersion}`);
						return fastly.deleteDomain(newVersion, domain.name);
					}
				}));
				log.info('Deleted old domains');

				//upload new domains
				yield Promise.all(backendData.domains.map(domain => {
					if (options.skipDomains.some(function(c) { return domain.name.indexOf(c) >= 0; })) {
						log.verbose(`  Skipping protected domain "${domain.name}" for version ${newVersion}`);
						return;
					} else {
						log.verbose(`Uploading "${domain.name}" for version ${newVersion}`);
						return fastly.createDomain(newVersion, domain)
							.then(() => log.verbose(`✓ Domain ${domain.name} uploaded`));
					}
				}));
				log.info('Uploaded new domains');
			}

			// Healthchecks
			if (backendData.healthchecks) {
				log.verbose('Now, delete all existing healthchecks');
				const currentHealthchecks = yield fastly.getHealthcheck(newVersion);
				yield Promise.all(currentHealthchecks.map(h => fastly.deleteHealthcheck(newVersion, h.name)));
				log.info('Deleted old healthchecks');

				// Create new healthchecks
				//log.verbose(`About to upload ${backendData.healthchecks.length} healthchecks`);
				yield Promise.all(backendData.healthchecks.map(h => {
					log.verbose(`upload healthcheck ${h.name}`);
					return fastly.createHealthcheck(newVersion, h).then(() => log.verbose(`✓ Healthcheck ${h.name} uploaded`));
				}));
				log.info('Uploaded new healthchecks');
			}

			// Conditions
			if (backendData.conditions) {
				// delete old conditions
				let oldConditions = yield fastly.getConditions(newVersion);
				yield Promise.all(oldConditions.map(condition => {
					if (options.skipConditions.some(function(c) { return condition.name.indexOf(c) >= 0; })) {
						log.verbose(`  Skipping protected condition "${condition.name}" for version ${newVersion}`);
						return;
					} else {
						log.verbose(`  Deleting "${condition.name}" for version ${newVersion}`);
						return fastly.deleteCondition(newVersion, condition.name);
					}
				}));
				log.info('Deleted old conditions');

				//upload new conditions
				yield Promise.all(backendData.conditions.map(condition => {
					if (options.skipConditions.some(function(c) { return condition.name.indexOf(c) >= 0; })) {
						log.verbose(`  Skipping protected condition "${condition.name}" for version ${newVersion}`);
						return;
					} else {
						log.verbose(`Uploading "${condition.name}" for version ${newVersion}`);
						return fastly.createCondition(newVersion, condition)
							.then(() => log.verbose(`✓ Condition ${condition.name} uploaded`));
					}
				}));
				log.info('Uploaded new conditions');
			}

			// Headers
			if (backendData.headers) {
				log.verbose('Now, delete all existing headers');
				const currentHeaders = yield fastly.getHeaders(newVersion)
				yield Promise.all(currentHeaders.map(h => fastly.deleteHeader(newVersion, h.name)));
				log.info('Deleted old headers');

				// Create new headers
				yield Promise.all(backendData.headers.map(h => {
					log.verbose(`upload header ${h.name}`);
					return fastly.createHeader(newVersion, h)
						.then(() => log.verbose(`✓ Header ${h.name} uploaded`));
				}));
				log.info('Uploaded new headers');
			}

			// Response Objects
			if (backendData.response_objects) {
				// delete old conditions
				let oldResponses = yield fastly.getResponseObjects(newVersion);
				yield Promise.all(oldResponses.map(response => {
					if (options.skipResponses.some(function(r) { return response.name.indexOf(r) >= 0; })) {
						log.verbose(`  Skipping protected response object "${response.name}" for version ${newVersion}`);
						return;
					} else {
						log.verbose(`  Deleting "${response.name}" for version ${newVersion}`);
						return fastly.deleteResponseObject(newVersion, response.name);
					}
				}));
				log.info('Deleted old response objects');

				//upload new conditions
				yield Promise.all(backendData.response_objects.map(response => {
					if (options.skipResponses.some(function(r) { return response.name.indexOf(r) >= 0; })) {
						log.verbose(`  Skipping protected response object "${response.name}" for version ${newVersion}`);
						return;
					} else {
						log.verbose(`Uploading "${response.name}" for version ${newVersion}`);
						return fastly.createResponseObject(newVersion, response)
							.then(() => log.verbose(`✓ Response object ${response.name} uploaded`));
					}
				}));
				log.info('Uploaded new response objects');
			}

			// Cache Settings
			if (backendData.cache_settings) {
				log.verbose('Now, delete all existing cache_settings');
				const currentCacheSettings = yield fastly.getCacheSettings(newVersion)
				yield Promise.all(currentCacheSettings.map(h => fastly.deleteCacheSettings(newVersion, h.name)));
				log.info('Deleted old cache_settings');

				// Create new cache_settings
				yield Promise.all(backendData.cache_settings.map(h => {
					log.verbose(`upload cache settings ${h.name}`);
					return fastly.createCacheSettings(newVersion, h)
						.then(() => log.verbose(`✓ Cache setting ${h.name} uploaded`));
				}));
				log.info('Uploaded new cache_settings');
			}

			// Settings
			if (backendData.settings) {
				// Update Settings
				log.verbose(`update settings`);
				fastly.updateSettings(newVersion, backendData.settings)
					.then(() => log.verbose(`✓ Setting updated`));
				log.info('Updated settings');
			}

			// Backends
			if (backendData.backends) {
				log.verbose('Now, delete all existing backends');
				const currentBackends = yield fastly.getBackend(newVersion);
				yield Promise.all(currentBackends.map(b => fastly.deleteBackendByName(newVersion, b.name)));
				log.info('Deleted old backends');

				// Create new backends
				yield Promise.all(backendData.backends.map(b => {
					log.verbose(`upload backend ${b.name}`);
					return fastly.createBackend(newVersion, b).then(() => log.verbose(`✓ Backend ${b.name} uploaded`));
				}));
				log.info('Uploaded new backends');
			}

			const loggers = {
				'logentries': {
					'get':    fastly.getLoggingLogentries,
					'delete': fastly.deleteLoggingLogentriesByName,
					'create': fastly.createLoggingLogentries,
				},
				'ftp':        {
					'get':    fastly.getLoggingFtp,
					'delete': fastly.deleteLoggingFtpByName,
					'create': fastly.createLoggingFtp,
				},
				'syslogs':     {
					'get':    fastly.getLoggingSyslog,
					'delete': fastly.deleteLoggingSyslogByName,
					'create': fastly.createLoggingSyslog,
				},
				'sumologics':     {
					'get':    fastly.getLoggingSumologic,
					'delete': fastly.deleteLoggingSumologicByName,
					'create': fastly.createLoggingSumologic,
				},
				's3s':     {
					'get':    fastly.getLoggingS3,
					'delete': fastly.deleteLoggingS3ByName,
					'create': fastly.createLoggingS3,
				}
			};

			for (const logger in loggers) {
				if (loggers.hasOwnProperty(logger)) {
					if (backendData[logger]) {
						log.verbose(`Now, delete all existing logging ${logger}`);
						const currentLoggers = yield loggers[logger].get(activeVersion);

						yield Promise.all(currentLoggers.map(l => loggers[logger].delete(newVersion, l.name)));
						log.verbose(`Deleted old logging ${logger}`);

						// Create new loggers
						yield Promise.all(backendData[logger].map(l => {
							log.verbose(`upload logging ${logger} ${l.name}`);
							return loggers[logger].create(newVersion, l)
								.then(() =>
									log.verbose(`✓ Logger ${logger}/${l.name} uploaded`)
								);
						}));
						log.info(`Uploaded new logging ${logger}`);
					}
				}
			}
		}

		// delete old vcl
		let oldVcl = yield fastly.getVcl(newVersion);
		yield Promise.all(oldVcl.map(vcl => {
			if (options.protected.some(function(v) { return vcl.name.indexOf(v) >= 0; })) {
				log.verbose(`Skipping protected file "${vcl.name}" for version ${newVersion}`);
				return;
			} else {
				log.verbose(`Deleting "${vcl.name}" for version ${newVersion}`);
				return fastly.deleteVcl(newVersion, vcl.name);
			}
		}));
		log.info('Deleted old vcl');

		//upload new vcl
		log.info('Uploading new VCL');
		yield Promise.all(vcls.map(vcl => {
			log.verbose(`Uploading new VCL ${vcl.name} with version ${newVersion}`);
			return fastly.updateVcl(newVersion, {
				name: vcl.name,
				content: vcl.content
			});
		}));

		// set the main vcl file
		log.verbose(`Try to set "${options.main}" as the main entry point`);
		yield fastly.setVclAsMain(newVersion, options.main);
		log.info(`"${options.main}" set as the main entry point`);

		// validate
		log.verbose(`Validate version ${newVersion}`);
		let validationResponse = yield fastly.validateVersion(newVersion)

		if (validationResponse.status !== 'ok') {
			let error = new Error('VCL Validation Error');
			error.type = symbols.VCL_VALIDATION_ERROR;
			error.validation = validationResponse.msg;
			throw error;

		} else {
			log.info(`Version ${newVersion} looks ok`);

			let activate = options.autoactivate;

			if ( ! options.autoactivate ) {
				// Prompt the user to activate or wait
				let message = 'Version ' + newVersion + ' has been deployed but was not activated.';
				const schema = {
					properties: {
						activatenow: {
							message: 'Would you like to activate version ' + newVersion + ' now?',
							default: 'Y'
						}
					}
				};
				prompt.start();
				prompt.get(schema, function (err, result) {
					if ( result.activatenow == 'Y' || result.activatenow == 'y' ) {
						activate = true;
						message = 'Version ' + newVersion + ' has been deployed and activated.';
					}


					let activationResponse = co.wrap(function* (val) {
					  if ( activate ) {
					  	log.info('Activating....');
					  	return yield fastly.activateVersion(newVersion);
						}
					});

					log.success(message);
					log.art('superman', 'success');
				});
			} else {
				// Auto activating without prompt
				let message = 'Version ' + newVersion + ' has been deployed and activated.';

				let activationResponse = co.wrap(function* (val) {
				  if ( activate ) {
				  	log.info('Activating....');
				  	return yield fastly.activateVersion(newVersion);
					}
				});

				log.success(message);
				log.art('superman', 'success');
			}
		}

	});
}

module.exports = task;

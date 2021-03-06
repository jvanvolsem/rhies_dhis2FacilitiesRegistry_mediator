#!/usr/bin/env node
'use strict'


const formidable = require('formidable');
const express = require('express');
const medUtils = require('openhim-mediator-utils');
const winston = require('winston');
const _ = require('underscore');
const utils = require('./utils');

var tools = require('../utils/tools');
var getFacilityRegistry = [];


// Logging setup
winston.remove(winston.transports.Console);
winston.add(winston.transports.Console, { level: 'info', timestamp: true, colorize: true });

// Config
var config = {}; // this will vary depending on whats set in openhim-core
const apiConf = process.env.NODE_ENV === 'test' ? require('../config/test') : require('../config/config');
const mediatorConfig = require('../config/mediator.json');

var port = process.env.NODE_ENV === 'test' ? 7001 : mediatorConfig.endpoints[0].port;

/**
 * setupApp - configures the http server for this mediator
 *
 * @return {express.App}  the configured http server
 */
function setupApp() {
  const app = express();

  //Call Facility record pulling fucntion
  tools.getFacilityRecordFromDHIS2(function(resultat){
    
    var resultTab = []
    resultTab = tools.structureFacilityRecord(resultat);
    console.log(resultTab);


  });

  function reportEndOfProcess(req, res, error, statusCode, message) {
    res.set('Content-Type', 'application/json+openhim')
    var responseBody = message;
    var stateLabel = "";
    let orchestrations = [];

    var headers = { 'content-type': 'application/json' }
    if (error) {
      stateLabel = "Failed";
      winston.error(message, error);
    } else {
      stateLabel = "Successful";
      winston.info(message);
    }
    var orchestrationResponse = { statusCode: statusCode, headers: headers }
    orchestrations.push(utils.buildOrchestration('Primary Route', new Date().getTime(), req.method, req.url, req.headers, req.body, orchestrationResponse, responseBody))
    res.send(utils.buildReturnObject(mediatorConfig.urn, stateLabel, statusCode, headers, responseBody, orchestrations, { property: 'Primary Route' }));
  }

  app.all('*', (req, res) => {
    winston.info(`Processing ${req.method} request on ${req.url}`)
    if (req.method == 'POST' && req.url == apiConf.api.urlPattern) {
      var form = new formidable.IncomingForm();
      form.parse(req, function (err, fields, files) {
        var data = fields;

        winston.info('Encounter received ...')

        if (apiConf.verbose == true) {
          if (utils.isFineValue(fields) == true && utils.isFineValue(fields.encounter) == true && utils.isFineValue(fields.encounter.obs) == true) {
            console.log("--> Received encounter obs: ", JSON.stringify(fields.encounter.obs));
          } else {
            if (utils.isFineValue(fields) == true && utils.isFineValue(fields.encounter) == true) {
              console.log("--> Received encounter: ", JSON.stringify(fields.encounter));
            } else {
              console.log("--> Received data: ", JSON.stringify(fields));
            }
          }
        }
      })
    }
  });
  return app
}




/**
 * start - starts the mediator
 *
 * @param  {Function} callback a node style callback that is called once the
 * server is started
 */
function start(callback) {
    if (apiConf.api.trustSelfSigned) { process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0' }
  
    //if (apiConf.register) {
    if (false) {
      medUtils.registerMediator(apiConf.api, mediatorConfig, (err) => {
        if (err) {
          winston.error('Failed to register this mediator, check your config')
          winston.error(err.stack)
          process.exit(1)
        }
        apiConf.api.urn = mediatorConfig.urn
        medUtils.fetchConfig(apiConf.api, (err, newConfig) => {
          winston.info('Received initial config:')
          winston.info(JSON.stringify(newConfig))
          config = newConfig
          if (err) {
            winston.error('Failed to fetch initial config')
            winston.error(err.stack)
            process.exit(1)
          } else {
            winston.info('Successfully registered mediator!')
            let app = setupApp()
            const server = app.listen(port, () => {
              if (apiConf.heartbeat) {
                let configEmitter = medUtils.activateHeartbeat(apiConf.api)
                configEmitter.on('config', (newConfig) => {
                  winston.info('Received updated config:')
                  winston.info(JSON.stringify(newConfig))
                  // set new config for mediator
                  config = newConfig
  
                  // we can act on the new config received from the OpenHIM here
                  winston.info(config)
                })
              }
              callback(server)
            })
          }
        })
      })
    } else {
      // default to config from mediator registration
      config = mediatorConfig.config
      let app = setupApp()
      const server = app.listen(port, () => callback(server))
  
    }
  }
  exports.start = start
  
  if (!module.parent) {
    // if this script is run directly, start the server
    start(() => winston.info(`Listening on ${port}...`))
  }
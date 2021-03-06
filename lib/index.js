var _ = require('lodash');
var debug = require('debug')('outpost-express');
var passport = require('passport');
var inflection = require('inflection');
var jsonFormatter = require('./json-formatter');

module.exports = function outpostExpress (services, options) {

  options = options || {};
  options.formatters = options.formatters || {};
  if (!options.formatters.json) {
    options.formatters.json = jsonFormatter;
  }
  options.localUserScope = options.localUserScope || ['me'];

  return [
    function invokeAction (req, res, next) {
      var uri = req.originalUrl;
      var method = req.method;
      var ctx = {
        status: 200,
        auth: {},
        params: _.merge({}, req.query, req.body, req.files)
      };
      for (var s in services) {
        var service = services[s];
        var resources = service.getResources();
        for (var i = 0, l = resources.length; i < l; i++) {
          var resource = resources[i];
          var uriParams = resource.matches(uri);
          if (uriParams !== false) {
            _.merge(ctx.params, uriParams);
            debug('resource match found: ' + resource.name + ' (' + resource.pattern + ')');
            var action = resource.getAction(inflection.camelize(method, true));
            if (action) {
              var authenticate = action.auth && action.auth.scope ?
                passport.authenticate(action.auth.type || 'basic', { session: false }) :
                function (req, res, cb) {
                  return cb();
                };
              return authenticate(req, res, function (err) {
                if (err) { return next(err); }
                if (req.auth && req.auth.type === 'user') {
                  ctx.auth = {
                    user: req.user,
                    client: req.auth.client,
                    scope: req.auth.scope
                  };
                } else if (req.auth && req.auth.type === 'client') {
                  ctx.auth = {
                    client: req.user,
                    scope: req.auth.scope
                  };
                } else if (req.user){
                  ctx.auth = {
                    user: req.user,
                    scope: options.localUserScope
                  };
                }
                action
                  .invoke(ctx)
                  .then(function (entity) {
                    res.statusCode = ctx.status;
                    res.entity = entity;
                    debug('returning entity');
                    next();
                  })
                  .catch(function (err) {
                    debug('throwing error', err);
                    next(err);
                  });
              });
            }
          }
        }
      }
      return next();
    },
    function renderEntity (req, res, next) {
      var entity = res.entity;
      var scheme = req.get('x-forwarded-proto') ? req.get('x-forwarded-proto') : req.protocol;
      var baseUri = scheme + '://' + req.get('host');
      if (req.get('x-api-root-path')) {
        baseUri += req.get('x-api-root-path');
      }
      if (!entity) {
        debug('no entity found, skipping formatting');
        return next();
      }
      var etag = entity.body._etag || entity.meta.etag;
      if (etag) {
        res.set('Etag', etag);
      }
      if (entity.meta) {
        if (entity.meta.location) {
          res.location(entity.meta.location);
        }
        if (entity.meta.lastModified !== undefined) {
          res.set('Last-Modified', entity.meta.lastModified);
        }
        if (entity.meta.expires !== undefined) {
          res.set('Expires', entity.meta.expires);
        }
        if (entity.meta.language !== undefined) {
          res.set('Content-Language', entity.meta.language);
        }
      }
      if (entity.links) {
        var links = {};
        for (var link in entity.links) {
          links[entity.links[link].rel] = baseUri + entity.links[link].href;
        }
        res.links(links);
      }
      if (req.method.toLowerCase() === 'head') {
        return next();
      }
      res.set('Vary', 'Authorization,Accept');
      var formatOptions = {
        baseUri: baseUri,
        includeActions: true,
        includeLinks: true,
        includeEmbedded: true,
        includeMeta: true
      };
      if ('undefined' !== typeof req.query.auth_token) {
        formatOptions.queryString = { access_token: req.query.auth_token };
      }
      if ('undefined' !== typeof req.query._actions) {
        formatOptions.includeActions = [0, '0', false, 'false', 'no'].indexOf(req.query._actions) === -1;
      }
      if ('undefined' !== typeof req.query._links) {
        formatOptions.includeLinks = [0, '0', false, 'false', 'no'].indexOf(req.query._links) === -1;
      }
      if ('undefined' !== typeof req.query._embedded) {
        formatOptions.includeEmbedded = [0, '0', false, 'false', 'no'].indexOf(req.query._embedded) === -1;
      }
      if ('undefined' !== typeof req.query._meta) {
        formatOptions.includeMeta = [0, '0', false, 'false', 'no'].indexOf(req.query._meta) === -1;
      }
      var format = req.accepts(_.keys(options.formatters));
      if (format && options.formatters[format]) {
        debug('formatting entity as ' + format);
        options.formatters[format].formatEntity(res, formatOptions);
      } else {
        debug('defaulting entity format as json');
        options.formatters['json'].formatEntity(res, formatOptions);
      }
    },
    function (err, req, res, next) {
      debug(err);
      res.status(err.status || 500);
      var format = req.accepts(_.keys(options.formatters));
      if (format) {
        options.formatters[format].formatError(err, res);
      } else {
        options.formatters['json'].formatError(err, res);
      }
    }
  ];
};

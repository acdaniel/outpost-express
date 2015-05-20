var _ = require('lodash');
var debug = require('debug')('outpost-express');
var jsonFormatter = require('./json-formatter');

module.exports = function outpostExpress (services, formatters) {

  formatters = formatters || {};
  if (!formatters.json) {
    formatters.json = jsonFormatter;
  }

  return [
    function invokeAction (req, res, next) {
      var uri = req.originalUrl;
      var method = req.method;
      var ctx = {
        status: 200,
        auth: {},
        params: {
          input: _.merge({}, req.query, req.body)
        }
      };
      // NOTE using req.auth here because passport doesn't like authInfo for BASIC auth
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
      }

      for (var s in services) {
        var service = services[s];
        var resources = service.getResources();
        for (var r in resources) {
          var resource = resources[r];
          var uriParams = resource.matches(uri);
          if (uriParams !== false) {
            ctx.params.uri = uriParams;
            debug('resource match found: ' + resource.name + ' (' + resource.pattern + ')');
            var action = resource.getAction(method);
            if (action) {
              return action
                .invoke(ctx)
                .then(function (entity) {
                  res.statusCode = ctx.status;
                  res.entity = entity;
                  return next();
                })
                .done(null, next);
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
      var options = {
        baseUri: baseUri,
        includeActions: true,
        includeLinks: true,
        includeEmbedded: true,
        includeMeta: true
      };
      if (req.query.access_token) {
        options.queryString = {access_token: req.query.access_token};
      }
      if (req.query._actions) {
        options.includeActions = !!req.query._actions;
      }
      if (req.query._links) {
        options.includeLinks = !!req.query._links;
      }
      if (req.query._embedded) {
        options.includeEmbedded = !!req.query._embedded;
      }
      if (req.query._meta) {
        options.includeMeta = !!req.query._meta;
      }
      var format = req.accepts(_.keys(formatters));
      if (format) {
        formatters[format](res, options);
      } else {
        formatters['json'](res, options);
      }
    }
  ];
};

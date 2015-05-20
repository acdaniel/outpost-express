/* jshint maxdepth: false */

var util = require('util');
var _ = require('lodash');
var Entity = require('outpost-services').Entity;
var Link = require('outpost-services').Link;

// JSON Responder
// ---

// Returns the entity as a JSON object.

module.exports = {

  formatError: function (err, res, options) {
    res.json({
      _type: 'error',
      status: res.statusCode,
      message: err.message,
      err: err
    });
  },

  formatEntity: function (res, options) {
    var baseUri = options.baseUri;
    var q = options.queryString;

    function formatEntity (entity) {
      if (!entity) {
        return undefined;
      }
      var obj = {};
      obj = formatObject(entity.type || '', entity.body);

      // add meta info
      if (options.includeMeta) {
        var meta = {}, hasMeta = false;
        if (entity._etag) {
          meta.etag = entity.etag;
          hasMeta = true;
        }
        if (entity.lastModified) {
          meta.lastModified = entity.lastModified;
          hasMeta = true;
        }
        if (entity.expires) {
          meta.expires = entity.expires;
          hasMeta = true;
        }
        if (hasMeta) {
          obj._meta = meta;
        }
      }

      //add embedded
      if (options.includeEmbedded && !_.isEmpty(entity.embedded)) {
        obj._embedded = {};
        for (var e in entity.embedded) {
          if (util.isArray(entity.embedded[e])) {
            obj._embedded[e] = formatArray(entity.embedded[e]);
          } else {
            obj._embedded[e] = formatEntity(entity.embedded[e]);
          }
        }
      }
      // add links
      if (options.includeLinks && !_.isEmpty(entity.links)) {
        obj._links = {};
        for (var l in entity.links) {
          if (util.isArray(entity.links[l])) {
            obj._links[l] = formatArray(entity.links[l]);
          } else {
            obj._links[l] = formatLink(entity.links[l]);
          }
        }
      }
      // add actions
      if (options.includeActions && !_.isEmpty(entity.actions)) {
        obj._actions = {};
        for (var a in entity.actions) {
          obj._actions[a] = formatAction(entity.actions[a]);
        }
      }
      return obj;
    }

    function formatAction (action) {
      return action;
    }

    function formatLink (link) {
      var buildLink = function (link) {
        var obj = {};
        if (link.href) {
          var schemeRegex = /^([a-z][a-z0-9+.-]*:(\/\/)?)|\/\//i;
          if (schemeRegex.test(link.href)) {
            obj.href = link.href;
          } else {
            obj.href = baseUri + link.href;
          }
        }
        if (link.title) {
          obj.title = link.title;
        }
        if (link.template) {
          obj.template = baseUri + link.template;
        }
        return obj;
      };
      if (util.isArray(link)) {
        var arr = [];
        for (var i = 0, l = link.length; i < l; i++) {
          arr.push(buildLink(link[i]));
        }
        return arr;
      } else {
        return buildLink(link);
      }
    }

    function formatArray (body) {
      var arr = [];
      for (var i = 0; i < body.length; i++) {
        if (body[i] instanceof Entity) {
          arr.push(formatEntity(body[i]));
        } else if (body[i] instanceof Link) {
          arr.push(formatLink(body[i]));
        } else if (util.isArray(body[i])) {
          arr.push(formatArray(body[i]));
        } else {
          arr.push(body[i]);
        }
      }
      return arr;
    }

    function formatObject (type, body) {
      var obj = type ? { _type: type } : {};
      for (var p in body) {
        if (body[p] instanceof Entity) {
          // if (p.substr(0, 1) === '_') { continue; }
          obj[p] = formatEntity(body[p]);
        } else if (body[p] instanceof Link) {
          obj[p] = formatLink(body[p]);
        } else if (util.isArray(body[p])) {
          obj[p] = formatArray(body[p]);
        } else {
          obj[p] = body[p];
        }
      }
      return obj;
    }

    res.send(formatEntity(res.entity));
  }
};

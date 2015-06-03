'use strict';

// miscellaneous
var verbose = require('../boot').getGeneralSettings().verbose;
var formOps = require('./formOps');
var db = require('../db');
var users = db.users();
var reports = db.reports();

var MAX_STAFF_ROLE = 3;

var MIMETYPES = {
  html : 'text/html',
  jpg : 'image/jpeg',
  jpeg : 'iamge/jpeg',
  htm : 'text/html',
  otf : 'application/x-font-otf',
  ttf : 'application/x-font-ttf',
  woff : 'application/x-font-woff',
  js : 'application/javascript',
  css : 'text/css',
  png : 'image/png'
};

exports.getMaxStaffRole = function() {
  return MAX_STAFF_ROLE;
};

exports.getMime = function getHeader(pathName) {

  var pathParts = pathName.split('.');

  var mime;

  if (pathParts.length) {
    var extension = pathParts[pathParts.length - 1];
    mime = MIMETYPES[extension.toLowerCase()] || 'text/plain';

  } else {
    mime = 'text/plain';
  }

  return mime;
};

// parameters must be an array of objects. each object must contain two keys:
// one with a string with the name of the parameter, the other with a number
// with its maximum length
exports.sanitizeStrings = function(object, parameters) {

  for (var i = 0; i < parameters.length; i++) {
    var parameter = parameters[i];

    if (object.hasOwnProperty(parameter.field)) {

      object[parameter.field] = object[parameter.field].toString().trim();

      if (!object[parameter.field].length) {

        delete object[parameter.field];

      } else if (parameter.length) {
        object[parameter.field] = object[parameter.field].substring(0,
            parameter.length);
      }
    }
  }

};

// It uses the provided contentType and builds a header ready for CORS.
// Currently it just allows everything.
exports.corsHeader = function(contentType) {
  return [ [ 'Content-Type', contentType ],
      [ 'access-control-allow-origin', '*' ] ];
};

exports.getGlobalRoleLabel = function(role) {

  switch (role) {
  case 0:
    return 'Root';
  case 1:
    return 'Admin';
  case 2:
    return 'Global volunteer';
  case 3:
    return 'Global janitor';
  default:
    return 'User';
  }

};

exports.getManagementData = function(userRole, userLogin, callback) {

  if (userRole > MAX_STAFF_ROLE) {

    var error = 'Your global role does not allow you';

    callback(error + ' to retrieve this information.');

  } else {

    users.find({
      login : {
        $ne : userLogin
      },
      globalRole : {
        $gt : userRole,
        $lte : MAX_STAFF_ROLE
      }
    }, {
      _id : 0,
      login : 1,
      globalRole : 1
    }).sort({
      login : 1
    }).toArray(function gotUsers(error, users) {

      if (error) {
        callback(error);
      } else {

        // style exception, too simple
        reports.find({
          global : true,
          closedBy : {
            $exists : false
          }
        }).sort({
          creation : -1
        }).toArray(function(gotReportserror, reports) {
          callback(error, users, reports);
        });
      }
      // style exception, too simple

    });
  }
};
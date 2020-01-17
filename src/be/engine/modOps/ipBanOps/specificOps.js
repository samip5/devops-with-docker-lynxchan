'use strict';

var mongo = require('mongodb');
var ObjectID = mongo.ObjectID;
var db = require('../../../db');
var boards = db.boards();
var bans = db.bans();
var posts = db.posts();
var threads = db.threads();
var offenseRecords = db.offenseRecords();
var defaultBanMessage;
var locationOps;
var redactedModNames;
var logger;
var logOps;
var miscOps;
var minClearIps;
var captchaOps;
var common;
var lang;

exports.appealArguments = [ {
  length : 512,
  field : 'appeal',
  removeHTML : true
} ];

exports.loadSettings = function() {

  var settings = require('../../../settingsHandler').getGeneralSettings();
  defaultBanMessage = settings.defaultBanMessage;

  minClearIps = settings.clearIpMinRole;
  redactedModNames = settings.redactModNames;

  if (!defaultBanMessage) {
    defaultBanMessage = lang().miscDefaultBanMessage;
  }

};

exports.loadDependencies = function() {

  locationOps = require('../../locationOps');
  captchaOps = require('../../captchaOps');
  logOps = require('../../logOps');
  common = require('..').common;
  logger = require('../../../logger');
  miscOps = require('../../miscOps');
  lang = require('../../langOps').languagePack;

};

// Section 1: Ban {
exports.appendThreadsToBanLog = function(informedThreads, pieces) {

  var logMessage = '';

  if (informedThreads.length) {
    logMessage += pieces.threadPiece;

    for (var i = 0; i < informedThreads.length; i++) {

      if (i) {
        logMessage += ', ';
      }

      logMessage += ' ' + informedThreads[i];

    }

  }

  return logMessage;

};

exports.appendPostsToBanLog = function(informedPosts, informedThreads, pieces) {

  var logMessage = '';

  if (informedPosts.length) {
    if (informedThreads.length) {
      logMessage += pieces.threadAndPostPiece;
    }

    logMessage += pieces.postPiece;

    for (var i = 0; i < informedPosts.length; i++) {
      if (i) {
        logMessage += ', ';
      }

      logMessage += ' ' + informedPosts[i];
    }

  }

  return logMessage;

};

exports.logBans = function(userData, board, informedPosts, informedThreads,
    parameters, callback) {

  var pieces = lang().logPostingBan;

  var logMessage = pieces.startPiece.replace('{$login}',
      redactedModNames ? lang().guiRedactedName : userData.login);

  if (parameters.global) {
    logMessage += pieces.globalPiece;
  }

  logMessage += pieces.midPiece;

  logMessage += exports.appendThreadsToBanLog(informedThreads, pieces);
  logMessage += exports.appendPostsToBanLog(informedPosts, informedThreads,
      pieces);

  logMessage += pieces.boardPiece.replace('{$board}', board);

  if (parameters.expiration) {
    logMessage += pieces.expirationPiece.replace('{$expiration}',
        parameters.expiration);
  } else {
    logMessage += pieces.permanentExpirationPiece;
  }

  logMessage += pieces.endPiece
      .replace('{$reason}', parameters.reasonBan || '');

  logOps.insertLog({
    user : userData.login,
    type : 'ban',
    time : new Date(),
    global : parameters.global,
    boardUri : board,
    description : logMessage
  }, callback);

};

exports.reloadPages = function(pages, board, informedThreads, informedPosts,
    parentThreads) {

  var rebuiltPages = [];

  for (var i = 0; i < pages.length; i++) {

    var page = pages[i];

    if (rebuiltPages.indexOf(page) === -1) {
      rebuiltPages.push(page);
      process.send({
        board : board,
        page : pages[i]
      });
    }
  }

  for (i = 0; i < informedThreads.length; i++) {
    process.send({
      board : board,
      thread : informedThreads[i]
    });

  }

  for (i = 0; i < parentThreads.length; i++) {

    var parent = parentThreads[i];

    if (informedThreads.indexOf(parent) === -1) {
      process.send({
        board : board,
        thread : parent
      });
    }
  }

};

exports.updateThreadsBanMessage = function(pages, parentThreads, userData,
    parameters, callback, informedThreads, informedPosts, board) {

  threads.updateMany({
    boardUri : board,
    threadId : {
      $in : informedThreads
    }
  }, {
    $set : {
      banMessage : parameters.banMessage || defaultBanMessage
    },
    $unset : miscOps.individualCaches
  }, function setMessage(error) {

    if (error) {
      callback(error);
    } else {

      // style exception, too simple
      posts.updateMany({
        boardUri : board,
        postId : {
          $in : informedPosts
        }
      }, {
        $set : {
          banMessage : parameters.banMessage || defaultBanMessage
        },
        $unset : miscOps.individualCaches
      }, function setMessage(error) {
        if (error) {
          callback(error);
        } else {

          exports.reloadPages(pages, board, informedThreads, informedPosts,
              parentThreads);

          exports.logBans(userData, board, informedPosts, informedThreads,
              parameters, callback);

        }

      });
      // style exception, too simple

    }

  });

};

exports.processFoundBanData = function(collection, board, parameters, user) {

  var bans = [];

  for (var i = 0; i < collection.length; i++) {

    var ban = {
      appliedBy : user.login,
      reason : parameters.reasonBan,
      expiration : parameters.expiration,
      warning : parameters.banType === 4
    };

    if (parameters.banType === 3) {
      ban.asn = collection[i];
    } else if (!parameters.banType || ban.warning) {
      ban.ip = collection[i];
    } else if (parameters.banType === 1 || parameters.banType === 2) {
      ban.range = miscOps.getRange(collection[i], parameters.banType === 2);
    } else {
      continue;
    }

    if (!parameters.global) {
      ban.boardUri = board;
    }

    bans.push(ban);

  }

  return bans;

};

exports.recordOffenses = function(foundIps, pages, parentThreads, userData,
    parameters, callback, informedThreads, informedPosts, board) {

  var records = [];

  for (var i = 0; i < foundIps.length; i++) {

    records.push({
      ip : foundIps[i],
      global : parameters.global,
      reason : parameters.reasonBan,
      date : new Date(),
      mod : userData.login,
      expiration : parameters.expiration
    });

  }

  offenseRecords.insertMany(records, function(error) {

    if (error) {
      callback(error);
    } else {

      if (!parameters.banType) {

        exports.updateThreadsBanMessage(pages, parentThreads, userData,
            parameters, callback, informedThreads, informedPosts, board);
      } else {
        callback();
      }

    }

  });

};

exports.createBans = function(foundIps, foundASNs, parentThreads, pages, board,
    userData, parameters, callback, informedThreads, informedPosts) {

  var newBans = exports.processFoundBanData(
      parameters.banType === 3 ? foundASNs : foundIps, board, parameters,
      userData);

  if (!newBans.length) {
    callback();
    return;
  }

  bans.insertMany(newBans, function createdBans(error, result) {
    if (error) {
      callback(error);
    } else {
      exports.recordOffenses(foundIps, pages, parentThreads, userData,
          parameters, callback, informedThreads, informedPosts, board);
    }
  });

};

exports.getPostIps = function(foundIps, foundASNs, pages, informedPosts, board,
    userData, parameters, callback, informedThreads) {

  posts.aggregate([ {
    $match : {
      boardUri : board,
      $or : [ {
        ip : {
          $nin : foundIps,
          $ne : null
        }
      }, {
        asn : {
          $nin : foundASNs,
          $ne : null
        }
      } ],
      postId : {
        $in : informedPosts
      }
    }
  }, {
    $group : {
      _id : 0,
      ips : {
        $addToSet : '$ip'
      },
      asns : {
        $addToSet : '$asn'
      },
      parents : {
        $addToSet : '$threadId'
      }
    }
  } ]).toArray(
      function gotIps(error, results) {

        if (error) {
          callback(error);
        } else if (!results.length) {

          exports.createBans(foundIps, foundASNs, [], pages, board, userData,
              parameters, callback, informedThreads, informedPosts);

        } else {

          // style exception, too simple
          threads.aggregate([ {
            $match : {
              threadId : {
                $in : results[0].parents
              }
            }
          }, {
            $group : {
              _id : 0,
              pages : {
                $addToSet : '$page'
              },
              parents : {
                $addToSet : '$threadId'
              }
            }
          } ]).toArray(
              function gotPages(error, pageResults) {
                if (error) {
                  callback(error);
                } else {
                  exports.createBans(foundIps.concat(results[0].ips), foundASNs
                      .concat(results[0].asns), pageResults[0].parents, pages
                      .concat(pageResults[0].pages), board, userData,
                      parameters, callback, informedThreads, informedPosts);

                }
              });
          // style exception, too simple

        }
      });

};

exports.getThreadIps = function(board, userData, reportedObjects, parameters,
    callback) {

  var informedThreads = [];
  var informedPosts = [];

  for (var i = 0; i < reportedObjects.length; i++) {

    var object = reportedObjects[i];

    if (board === object.board) {

      if (object.post) {
        informedPosts.push(+object.post);
      } else {
        informedThreads.push(+object.thread);
      }

    }

  }

  threads.aggregate([ {
    $match : {
      boardUri : board,
      $or : [ {
        ip : {
          $ne : null
        }
      }, {
        asn : {
          $ne : null
        }
      } ],
      threadId : {
        $in : informedThreads
      }
    }
  }, {
    $group : {
      _id : 0,
      ips : {
        $addToSet : '$ip'
      },
      asns : {
        $addToSet : '$asn'
      },
      pages : {
        $addToSet : '$page'
      }

    }
  } ]).toArray(
      function gotIps(error, results) {

        if (error) {
          callback(error);
        } else if (!results.length) {
          exports.getPostIps([], [], [], informedPosts, board, userData,
              parameters, callback, informedThreads);
        } else {
          exports.getPostIps(results[0].ips || [], results[0].asns || [],
              results[0].pages, informedPosts, board, userData, parameters,
              callback, informedThreads);
        }

      });

};

exports.iterateBoards = function(foundBoards, userData, reportedObjects,
    parameters, callback) {

  if (!foundBoards.length) {
    callback();
    return;
  }

  var board = foundBoards.shift();

  boards.findOne({
    boardUri : board
  }, function gotBoard(error, board) {
    if (error) {
      callback(error);
    } else if (!board) {
      exports.iterateBoards(foundBoards, userData, reportedObjects, parameters,
          callback);
    } else if (!common.isInBoardStaff(userData, board) && !parameters.global) {
      exports.iterateBoards(foundBoards, userData, reportedObjects, parameters,
          callback);
    } else {

      // style exception, too simple
      exports.getThreadIps(board.boardUri, userData, reportedObjects,
          parameters, function createdBans(error) {
            if (error) {
              callback(error);
            } else {
              exports.iterateBoards(foundBoards, userData, reportedObjects,
                  parameters, callback);
            }
          });
      // style exception, too simple

    }
  });

};

exports.isolateBoards = function(userData, reportedObjects, parameters,
    language, callback) {

  miscOps.sanitizeStrings(parameters, common.banArguments);

  parameters.banType = +parameters.banType;

  common.parseExpiration(parameters);

  var allowedToGlobalBan = userData.globalRole < miscOps.getMaxStaffRole();

  var allowedGlobalRangeBan = userData.globalRole <= minClearIps;

  if (parameters.global && !allowedToGlobalBan) {
    callback(lang(language).errDeniedGlobalBanManagement);
  } else if (!allowedGlobalRangeBan && parameters.global && parameters.range) {
    callback(lang(language).errDeniedGlobalRangeBanManagement);
  } else {
    var foundBoards = [];

    for (var i = 0; i < reportedObjects.length && i < 1000; i++) {
      var report = reportedObjects[i];

      if (report.board && foundBoards.indexOf(report.board) === -1) {
        foundBoards.push(report.board.toString());
      }
    }

    exports.iterateBoards(foundBoards, userData, reportedObjects, parameters,
        callback);
  }

};

exports.ban = function(userData, reportedObjects, parameters, captchaId,
    language, callback) {

  if (userData.globalRole <= miscOps.getMaxStaffRole()) {
    exports.isolateBoards(userData, reportedObjects, parameters, language,
        callback);

    return;
  }

  captchaOps.attemptCaptcha(captchaId, parameters.captcha, null, language,
      function solvedCaptcha(error) {
        if (error) {
          callback(error);
        } else {
          exports.isolateBoards(userData, reportedObjects, parameters,
              language, callback);
        }
      });

};
// } Section 1: Ban

// Section 2: Appeal {
exports.finishQuery = function(matchBlock, ip, callback) {

  locationOps.getASN(ip, function gotASN(error, asn) {

    if (error) {
      return callback(error);
    }

    var orBlock = [ {
      ip : ip
    }, {
      range : {
        $in : [ miscOps.getRange(ip), miscOps.getRange(ip, true) ]
      }
    }, {
      asn : asn
    } ];

    matchBlock.$or = orBlock;

    callback();
  });

};

exports.appealBan = function(ip, parameters, language, callback) {

  try {
    parameters.banId = new ObjectID(parameters.banId);
  } catch (error) {
    callback(lang(language).errBanNotFound);
    return;
  }

  miscOps.sanitizeStrings(parameters, exports.appealArguments);

  var matchBlock = {
    _id : parameters.banId,
    appeal : {
      $exists : false
    }
  };

  exports.finishQuery(matchBlock, ip, function finishedQuery(error) {

    if (error) {
      return callback(error);
    }

    // style exception, too simple
    bans.findOneAndUpdate(matchBlock, {
      $set : {
        appeal : parameters.appeal
      }
    }, function gotBan(error, result) {

      if (error) {
        callback(error);
      } else if (!result.value) {
        callback(lang(language).errBanNotFound);
      } else {
        callback();
      }

    });
    // style exception, too simple

  });

};
// } Section 2: Appeal

// Section 3: Deny appeal {
exports.writeDeniedAppeal = function(userData, ban, callback) {

  bans.updateOne({
    _id : ban._id
  }, {
    $set : {
      denied : true
    }
  }, function deniedAppeal(error) {
    if (error) {
      callback(error);
    } else {

      // style exception, too simple
      logOps.insertLog({
        user : userData.login,
        type : 'appealDeny',
        time : new Date(),
        boardUri : ban.boardUri,
        global : ban.boardUri ? false : true,
        description : lang().logAppealDenied.replace('{$login}',
            redactedModNames ? lang().guiRedactedName : userData.login)
            .replace('{$id}', ban._id)
      }, function logged() {
        callback(null, ban.boardUri);
      });
      // style exception, too simple

    }
  });

};

exports.checkAppealDenyBoardPermission = function(userData, ban, language,
    callback) {

  boards.findOne({
    boardUri : ban.boardUri
  }, function gotBoard(error, board) {
    if (error) {
      callback(error);
    } else if (!board) {
      callback(lang(language).errBoardNotFound);
    } else if (!common.isInBoardStaff(userData, board, 2)) {
      callback(lang(language).errDeniedBoardBanManagement);
    } else {
      exports.writeDeniedAppeal(userData, ban, callback);
    }
  });

};

exports.denyAppeal = function(userData, banId, language, callback) {

  var globalStaff = userData.globalRole < miscOps.getMaxStaffRole();

  try {
    banId = new ObjectID(banId);
  } catch (error) {
    callback(lang(language).errBanNotFound);
    return;
  }

  bans.findOne({
    _id : banId,
    appeal : {
      $exists : true
    },
    denied : {
      $exists : false
    }
  },
      function gotBan(error, ban) {
        if (error) {
          callback(error);
        } else if (!ban) {
          callback(lang(language).errBanNotFound);
        } else if (!ban.boardUri && !globalStaff) {
          callback(lang(language).errDeniedGlobalBanManagement);
        } else if (ban.boardUri) {
          exports.checkAppealDenyBoardPermission(userData, ban, language,
              callback);
        } else {
          exports.writeDeniedAppeal(userData, ban, callback);
        }
      });

};
// } Section 3: Deny appeal

// Section 4: Mass ban {
exports.getMassBans = function(parameters, userLogin) {

  var toRet = [];

  common.parseExpiration(parameters);

  for (var i = 0; i < parameters.ips.length; i++) {

    var ip = logger.convertIpToArray(parameters.ips[i].toString().trim());

    if (!ip) {
      continue;
    }

    toRet.push({
      appliedBy : userLogin,
      reason : parameters.reason,
      expiration : parameters.expiration,
      ip : ip
    });

  }

  return toRet;

};

exports.massBan = function(userData, parameters, language, callback) {

  if (userData.globalRole > 1) {
    callback(lang(language).errNotAllowedToMassBan);
    return;
  }

  miscOps.sanitizeStrings(parameters, common.banArguments);

  var banList = exports.getMassBans(parameters, userData.login);

  if (!banList.length) {
    callback();
    return;
  }

  bans.insertMany(banList, callback);

};
// } Section 4: Mass ban

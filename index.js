// boilerplate code copied from https://tutorials.botsfloor.com/building-a-node-js-slack-bot-before-your-microwave-popcorn-is-ready-8946651a5071
// more refined request handling implementation copied initially from https://github.com/slackapi/node-slack-sdk/blob/bc4260466fb06c3a31d53c609d87bc3dccaba987/examples/express-all-interactions/server.js#L217
require(`dotenv`).config();

const express = require(`express`); // significantly simplifies app routing
const bodyParser = require(`body-parser`); // parses request bodies
const redis = require(`ioredis`); // allows us to set up a redis client locally

//const request = require("request");

// client that will connect to the redis db and handle interactions between slack and the db
let redisClient = new redis({
  port: process.env.REDIS_PORT,
  host: process.env.REDIS_HOSTNAME,
  password: process.env.REDIS_PASSWORD,
});

// Creates express app
const app = express();
// The port used for Express server
const PORT = 3000;
// Starts server
app.listen(process.env.PORT || PORT, function () {
  console.log('Bot is listening on port ' + PORT);
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Attach the slash command handler
app.post('/', bodyParser.urlencoded({ extended: false }), slackSlashCommand);

// Slack slash command handler
function slackSlashCommand(req, res, next) {
  let responseJSON = {}; // obj to be filled with data based on which case is met by the user's request and then sent back at the end
  let responseSet = false;
  redisScanHelper().then(hashes => { // all commands need to check hashes in the db at some point, so get all of those and then proceed
    // odds initiation
    if (req.body.command === '/odds') {
      // if an id is in this text, continue, otherwise respond with error
      if (req.body.text.includes("<@")) {
        let challengedID = req.body.text.split('<@').pop().split(`>`)[0].split(`\|`)[0]; // grab the id of the challenged
        // users can only have one challenge active at a time for now, so check the db first to see if there are any and handle that case
        hashes.forEach(hash => {
          let involvedParties = hash.split(`\|`);
          involvedParties.forEach(id => {
            console.log("Here's the id being inspected: " + id + " and for reference here's the initiator's id: " + req.body.user_id + ", and the challenged id: " + challengedID);
            if (id === req.body.user_id || id === challengedID) {
              if (!responseSet) {
                responseJSON = {
                  text: "People can only have one outstanding challenge at a time, so you or they must resolve it first or cancel with /cancelodds",
                };
                responseSet = true;
              }
            }
          });
        });
        // handle bad case of a user trying to challenge themselves
        if (req.body.user_id === challengedID) {
          if (!responseSet) {
            responseJSON = {
              text: "You can't challenge yourself numbnuts!",
            };
            responseSet = true;
          }
        }
        // create a new hash with fields for all pertinant odds challenge data in redis by combining the initaitor and challenged ids
        let initiatorChallengedHash = req.body.user_id + "|" + challengedID; //challenge hash always puts initiator to the left and challenged to the right
        redisClient.hset(initiatorChallengedHash, 'upperLimit', 0, redis.print);
        // redisClient.hset(initiatorChallengedHash, 'initiator', req.body.user_id, redis.print);
        // redisClient.hset(initiatorChallengedHash, 'challenged', challengedID, redis.print);
        redisClient.hset(initiatorChallengedHash, 'initiatorOdds', 0, redis.print);
        redisClient.hset(initiatorChallengedHash, 'challengedOdds', 0, redis.print);
        if (!responseSet) {
          responseJSON = { // send back the successful response if all has gone well
            response_type: "in_channel",
            text: "<@" + challengedID + ">, you've been challenged!  Submit your upper bounds now with /setodds or cancel the challenge with /cancelodds",
          };
          console.log(responseJSON);
          responseSet = true;
        }
      }
      else { // bad case of no user specified
        if (!responseSet) {
          responseJSON = {
            text: "You need to specify who you're challenging!"
          };
          responseSet = true;
        }
      }
    }
    // setting upper limit of odds
    else if (req.body.command === '/setodds') {
      hashes.forEach(hash => {
        if (hash.split(`\|`)[1] === req.body.user_id) { // check that this hash has the user as the challenged
          let upperLimit = null;
          if (req.body.text.match(`[0-9]+`))
            upperLimit = req.body.text.match(`[0-9]+`)[0];
          if (upperLimit && upperLimit > 1 && upperLimit < Number.MAX_VALUE) { // check that there's a valid number in the text
            redisClient.hset(hash, 'upperLimit', upperLimit, redis.print);
            if (!responseSet) {
              responseJSON = {
                response_type: "in_channel",
                text: "<@" + req.body.user_id + ">, Has set their upper limit to " + upperLimit + ", now both they and the challenge initator must enter a value betweeen 1 and that number with /commitodds",
              };
              responseSet = true;
            }
          } else {
            if (!responseSet) {
              responseJSON = {  // case of a bad value
                text: "You need enter a valid integer!"
              };
              responseSet = true;
            }
          }
        }
      });
      // this user was not challenged, tell them so
      if (!responseSet) {
        responseJSON = {
          text: "You haven't been challenged!"
        };
        responseSet = true;
      }
    }
    // commiting an inividual's odds number
    else if (req.body.command === '/commitodds') {
      redisHashGetAllHelper(req.body.user_id).then(hashObj => {
        if (hashObj) {
          let involvedParties = hashObj.hash.split(`\|`);
          for (let i = 0; i < involvedParties.length; i++) {
            if (involvedParties[i] === req.body.user_id) { // check that this hash has the user involved
              let odds = null;
              if (req.body.text.match(`[0-9]+`))
                odds = req.body.text.match(`[0-9]+`)[0];
              if (odds && odds >= 1 && odds <= upperLimit) { // check that there's a valid number in the text 
                let newInitiatorOdds = hashObj.initiatorOdds;
                let newChallengedOdds = hashObj.challengedOdds;
                // set the odds of the corresponding involved user only if they haven't put one in already
                let oddsAlreadyEntered = false;
                if (i == 0) { // initiator
                  if (initiatorOdds == 0) {
                    newInitiatorOdds = odds;
                    redisClient.hset(hashObj.hash, 'initiatorOdds', odds, redis.print);
                  } else {
                    oddsAlreadyEntered = true;
                  }
                } else { // challenged
                  if (challengedOdds == 0) {
                    newChallengedOdds = odds;
                    redisClient.hset(hashObj.hash, 'challengedOdds', odds, redis.print);
                  } else {
                    oddsAlreadyEntered = true;
                  }
                }
                console.log("Initiator odds: " + newInitiatorOdds);
                console.log("Challenged odds: " + newChallengedOdds);
                // check to see if both parties have their odds entered.  If they do, send back the results and delete this hash from the db
                if (newInitiatorOdds != 0 && newChallengedOdds != 0) {
                  redisClient.del(hash);
                  if (!responseSet) {
                    responseJSON = {
                      response_type: "in_channel",
                      text: "Both parties have submitted their odds!  <@" + involvedParties[0] + "> has entered " + newInitiatorOdds + ", and <@" + involvedParties[1] + "> has entered " + newChallengedOdds + ".  Do with that information what you will...",
                    };
                    responseSet = true;
                  }
                  break;
                } else if (oddsAlreadyEntered) { // case of user having already entered valid odds previously
                  if (!responseSet) {
                    responseJSON = {
                      text: "You already entered your odds!",
                    };
                    responseSet = true;
                  }
                } else { // default successful odds committed message
                  if (!responseSet) {
                    responseJSON = {
                      text: "Odds entered successfully, waiting on opponent...",
                    };
                    responseSet = true;
                  }
                }
              } else { // case of a bad value
                if (!responseSet) {
                  responseJSON = {
                    text: "You need enter a valid integer (Reminder that the upper limit is " + upperLimit + ")",
                  };
                  responseSet = true;
                }
              }
            }
          }
        } else {
          // final case of no active challenges with this user
          if (!responseSet) {
            responseJSON = {
              text: "You have no active challenges right now!"
            };
            responseSet = true;
          }
        }
      });
    }
    // cancelling an outstanding odds challenge 
    else if (req.body.command === `/cancelodds`) {
      hashes.forEach(hash => {
        let involvedParties = hash.split(`\|`);
        involvedParties.forEach(id => { // check if this user matches either party in the hash
          console.log("Here's the id being inspected: " + id + " and for reference here's the canceller's id: " + req.body.user_id);
          if (id === req.body.user_id) {
            redisClient.del(hash);
            if (!responseSet) {
              responseJSON = {
                response_type: `in_channel`,
                text: "<@" + req.body.user_id + "> has cancelled their challenge.",
              };
              responseSet = true;
            }
          }
        })
      });
      // this user was not challenged, tell them so
      if (!responseSet) {
        responseJSON = {
          text: "You have no active challenges right now!",
        };
        responseSet = true;
      }
    }
  }).catch(err => { // errors from the db scan promise are caught here
    console.log(err);
    responseJSON = {
      text: "Error scanning the odds db"
    };
  });
  // send the final json back to the user
  console.log(responseJSON);
  res.json(responseJSON);
}

// helper function for scanning in the db that the redis client is attached to
let redisScanHelper = async () => {
  let cursor = 0; // iterator value for the scan function
  let hashes = []; // to be filled with hashes and sent back when all promises relating to this are fulfilled
  do {
    let scanReturn = await redisClient.scan(cursor);
    console.log(JSON.stringify(scanReturn));
    cursor = scanReturn[0];
    console.log("New cursor: " + cursor)
    let newHashes = scanReturn[1];
    keys = [...hashes, ...newHashes];
    console.log("New list of hashes: " + hashes);
  } while (cursor && cursor != 0);
  return Promise.all(hashes).catch((err) => {
    console.log(err);
    return Promise.reject(err);
  });
}

// helper function used to see if there's a match between a passed id and any hashes from a redis DB
let redisHashGetAllHelper = (id) => {
  let matchHash = null;
  let initiatorFlag = null;
  let hashObj = null;
  redisScanHelper().then(hashes => {
    hashes.forEach(hash => {
      let involvedParties = hash.split(`\|`);
      for (let i = 0; i < 2; i++) {
        if (involvedParties[i] === id) {
          matchHash = hash;
          if (i = 0)
            initiatorFlag = true;
          else
            initiatorFlag = false;
          break;
        }
      }
    });
  }).then(async () => {
    let hashInfo = await hgetall(matchHash);
    hashObj = {
      hash: matchHash,
      upperLimit: hashInfo[1],
      initiatorOdds: hashInfo[3],
      challengedOdds: hashInfo[5],
    }
  }).catch(err => { // errors from the db scan promise are caught here
    console.log(err);
  });
  return Promise.resolve(hashObj);
}
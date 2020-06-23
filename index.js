// boilerplate code copied from https://tutorials.botsfloor.com/building-a-node-js-slack-bot-before-your-microwave-popcorn-is-ready-8946651a5071
// more refined request handling implementation copied initially from https://github.com/slackapi/node-slack-sdk/blob/bc4260466fb06c3a31d53c609d87bc3dccaba987/examples/express-all-interactions/server.js#L217
require('dotenv').config();

const express = require('express'); // significantly simplifies app routing
const bodyParser = require('body-parser'); // parses request bodies
const redis = require('redis'); // allows us to set up a redis client locally

//const request = require("request");

// client that will connect to the redis db and handle interactions between slack and the db
let redisClient = redis.createClient({
  port: process.env.REDIS_PORT,
  host: process.env.REDIS_HOSTNAME
});
redisClient.auth(process.env.REDIS_PASSWORD, function (err, response) {
  if (err) {
    console.log("Couldn't authenticate with Redis db, check your credentials");
    throw err;
  }
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
  let responseSent = false; // flag for determining if a response has been sent, is used to prevent the app from sending multiple by accident and setting the keyUsed var in redisScanHelper
  // odds initiation
  if (req.body.command === '/odds') {
    // if an id is in this text, continue, otherwise respond with error
    if (req.body.text.includes("<@")) {
      let challengedID = req.body.text.split('<@').pop().split(`>`)[0].split(`\|`)[0]; // grab the id of the challenged
      // users can only have one challenge active at a time for now, so check the db first to see if there are any and handle that case
      redisScanHelper((hash) => {
        let involvedParties = hash.split(`\|`);
        involvedParties.forEach(id => {
          console.log("Here's the id being inspected: " + id + " and for reference here's the initiator's id: " + req.body.user_id + ", and the challenged id: " + challengedID);
          if (id === req.body.user_id || id === challengedID) {
            res.status(200).json({
              text: "People can only have one outstanding challenge at a time, so you or they must resolve it first or cancel with /cancelodds",
            });
            responseSent = true;
          }
        })
        return responseSent;
      });
      // handle bad case of a user trying to challenge themselves
      if (req.body.user_id === challengedID) {
        res.status(200).json({
          text: "You can't challenge yourself numbnuts!",
        });
        responseSent = true;
        return;
      }
      // create a new hash with fields for all pertinant odds challenge data in redis by combining the initaitor and challenged ids
      let initiatorChallengedHash = req.body.user_id + "|" + challengedID; //challenge hash always puts initiator to the left and challenged to the right
      redisClient.hset(initiatorChallengedHash, 'upperLimit', 0, redis.print);
      // redisClient.hset(initiatorChallengedHash, 'initiator', req.body.user_id, redis.print);
      // redisClient.hset(initiatorChallengedHash, 'challenged', challengedID, redis.print);
      redisClient.hset(initiatorChallengedHash, 'initiatorOdds', 0, redis.print);
      redisClient.hset(initiatorChallengedHash, 'challengedOdds', 0, redis.print);
      res.status(200).json({ // send back the successful response if all has gone well
        response_type: "in_channel",
        text: "<@" + challengedID + ">, you've been challenged!  Submit your upper bounds now with /setodds or cancel the challenge with /cancelodds",
      });
      responseSent = true;
      return;
    }
    else { // bad case of no user specified
      res.status(200).json({
        text: "You need to specify who you're challenging!"
      });
      responseSent = true;
      return;
    }
  }
  // setting upper limit of odds
  else if (req.body.command === '/setodds') {
    redisScanHelper((hash) => {
      // console.log(hash);
      // console.log(hash.split(`\|`)[1]);
      if (hash.split(`\|`)[1] === req.body.user_id) { // check that this hash has the user as the challenged
        let upperLimit = null;
        if (req.body.text.match(`[0-9]+`)) {
          console.log("All number matches: " + req.body.text.match(`[0-9]+`));
          upperLimit = req.body.text.match(`[0-9]+`)[0];
          console.log("First number grabbed to be the upper limit: " + upperLimit);
        }
        if (upperLimit && upperLimit > 1 && upperLimit < Number.MAX_VALUE) { // check that there's a valid number in the text
          redisClient.hset(hash, 'upperLimit', upperLimit, redis.print);
          res.status(200).json({
            response_type: "in_channel",
            text: "<@" + req.body.user_id + ">, Has set their upper limit to " + upperLimit + ", now both they and the challenge initator must enter a value betweeen 1 and that number with /commitodds",
          });
          responseSent = true;
        } else {
          res.status(200).json({  // case of a bad value
            text: "You need enter a valid integer!"
          });
          responseSent = true;
        }
      }
      return responseSent;
    });
    // this user was not challenged, tell them so
    if (!responseSent) {
      res.status(200).json({
        text: "You haven't been challenged!"
      });
      responseSent = true;
    }
    return;
  }
  // commiting an inividual's odds number
  else if (req.body.command === '/commitodds') {
    redisScanHelper((hash) => {
      let involvedParties = hash.split(`\|`);
      for (let i = 0; i < involvedParties.length; i++) {
        if (involvedParties[i] === req.body.user_id) { // check that this hash has the user involved
          let odds = null;
          if (req.body.text.match(`[0-9]+`)) {
            console.log("All number matches: " + req.body.text.match(`[0-9]+`));
            odds = req.body.text.match(`[0-9]+`)[0];
            console.log("First number grabbed to be the odds: " + odds);
          }
          redisClient.hget(hash, `upperLimit`, (err, reply) => { // wait to get the upperLimit back from redis, then execute based on that value returned
            if (err)
              throw err;
            else {
              console.log("Odds submitted: " + odds);
              console.log("Reply from hget of upperLimit: " + reply);
              if (odds && odds >= 1 && odds <= reply) { // check that there's a valid number in the text
                let initiatorOdds;
                let challengedOdds;
                redisClient.hget(hash, `initiatorOdds`, (err, iOdds) => { if (err) { throw err; } else { initiatorOdds = iOdds; } });
                redisClient.hget(hash, `challengedOdds`, (err, cOdds) => { if (err) { throw err; } else { challengedOdds = cOdds; } });
                // set the odds of the corresponding involved user only if they haven't put one in already
                let oddsAlreadyEntered = false;
                if (i === 0) { // initiator
                  if (initiatorOdds === 0) {
                    redisClient.hset(hash, 'initiatorOdds', odds, redis.print);
                  } else {
                    oddsAlreadyEntered = true;
                  }
                } else { // challenged
                  if (challengedOdds === 0) {
                    redisClient.hset(hash, 'challengedOdds', odds, redis.print);
                  } else {
                    oddsAlreadyEntered = true;
                  }
                }
                // update these vars with the new values
                redisClient.hget(hash, `initiatorOdds`, (err, iOdds) => { if (err) { throw err; } else { cosnole.log(iOdds);  initiatorOdds = iOdds; } });
                redisClient.hget(hash, `challengedOdds`, (err, cOdds) => { if (err) { throw err; } else { console.log(cOdds);  challengedOdds = cOdds; } });
                console.log("Initiator odds: " + initiatorOdds);
                console.log("Challenged odds: " + challengedOdds);
                // check to see if both parties have their odds entered.  If they do, send back the results and delete this hash from the db
                if (initiatorOdds !== 0 && challengedOdds !== 0) {
                  redisClient.del(hash);
                  res.status(200).json({
                    response_type: "in_channel",
                    text: "Both parties have submitted their odds!  <@" + involvedParties[0] + "> has entered " + initiatorOdds + ", and <@" + involvedParties[1] + "> has entered " + challengedOdds + ".  Do with that information what you will...",
                  });
                  responseSent = true;
                } else if (oddsAlreadyEntered) { // case of user having already entered valid odds previously
                  res.status(200).json({
                    text: "You already entered your odds!",
                  });
                  responseSent = true;
                } else { // default successful odds committed message
                  res.status(200).json({
                    text: "Odds entered successfully, waiting on opponent...",
                  });
                  responseSent = true;
                }
              } else { // case of a bad value
                res.status(200).json({
                  text: "You need enter a valid integer (Reminder that the upper limit is " + reply + ")",
                });
                responseSent = true;
              }
            }
          });
        }
      }
      return responseSent;
    });
    // final case of no active challenges with this user
    if (!responseSent) {
      res.status(200).json({
        text: "You have no active challenges right now!"
      });
      responseSent = true;
    }
    return;
  }
  // cancelling an outstanding odds challenge 
  else if (req.body.command === `/cancelodds`) {
    redisScanHelper((hash) => {
      let involvedParties = hash.split(`\|`);
      involvedParties.forEach(id => { // check if this user matches either party in the hash
        console.log("Here's the id being inspected: " + id + " and for reference here's the canceller's id: " + req.body.user_id);
        if (id === req.body.user_id) {
          redisClient.del(hash);
          res.status(200).json({
            response_type: `in_channel`,
            text: "<@" + req.body.user_id + "> has cancelled their challenge.",
          });
          responseSent = true;
        }
      })
      return responseSent;
    });
    console.log("Response sent status: " + responseSent);
    // this user was not challenged, tell them so
    if (!responseSent) {
      res.status(200).json({
        text: "You have no active challenges right now!",
      });
      responseSent = true;
    }
    return;
  }
}

// helper function for scanning in the db that the redis client is attached to
let redisScanHelper = async (func) => {
  let cursor = 0; // iterator value for the scan function
  // let keyUsed = false; // flag to break the loop if the key being looked at was used 
  // loop through the db using the iterator and check the groups of hashes it returns with whatever function was passed to this
  // do {
    
  //   redisClient.scan(cursor, (err, reply) => {
  //     if (err)
  //       throw err;
  //     else {
  //       cursor = reply[0]; // new cursor value is the first element
  //       console.log("Cursor value: " + cursor);
  //       let keys = reply[1]; // array of keys is second element
  //       console.log("Keys at the current cursor: " + keys);
  //       if (keys) {
  //         for (let i = 0; i < keys.length; i++) {
  //           keyUsed = func(keys[i]);
  //           if (keyUsed) {
  //             console.log("Key has been used!");
  //             break;
  //           }
  //         }
  //         //keys.forEach(func);
  //       }
  //     }
  //   });
  // } while (cursor && cursor !== 0 && !keyUsed);
  // console.log("Done looping through keys");
  let scanPromises = new Promise<Number>[];
  do {
    const [newCursor, keys] = await redisClient.scan(cursor);
    cursor = newCursor;
    scanPromises = [...scanPromise, ...keys];
  } while (cursor && cursor !== 0);
  return Promise.all(scanPromises).catch((err) => { throw err; });
}
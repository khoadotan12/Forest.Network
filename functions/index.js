const functions = require('firebase-functions');
const admin = require('firebase-admin');
const bodyParser = require('body-parser');
const express = require('express');
const serviceAccount = require('./config.json');
const fetch = require("fetch").fetchUrl;
const { decode, encode, sign } = require('./transaction');
const key = require('./key.json');
const app = express();

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://forest-network-dack.firebaseio.com",
});

const database = admin.database();
const { initialize } = require('./initialize');
function aaa(i) {
  console.log(i);
  fetch('https://komodo.forest.network/block?height=' + i, (error, meta, body) => {
    const resp = JSON.parse(body.toString());
    const num_txs = resp.result.block_meta.header.num_txs;
    if (num_txs !== "0") {
      const txs = resp.result.block.data.txs;
      const tx = decode(Buffer.from(txs[0], 'base64'));
      switch (tx.operation) {
        case 'create_account': {
          const address = database.ref('/users/' + tx.params.address);
          const account = database.ref('/users/' + tx.account);
          Promise.all([address.set({
            balance: 0,
            energy: 0,
            sequence: 0,
          }),
          account.once('value', snap => {
            if (snap.exists()) {
              const sequence = snap.val().sequence;
              account.update({
                sequence: sequence + 1,
              })
            }
          })]).then(() => {
            if (i < MAX_BLOCK)
              return loadBlock(i + 1);
            return true;
          }).catch(e => console.log(e));
          // address.set({
          //   balance: 0,
          //   energy: 0,
          //   sequence: 0,
          // }).then(() => {
          //   return account.once('value', snap => {
          //     if (snap.exists()) {
          //       const sequence = snap.val().sequence;
          //       account.update({
          //         sequence: sequence + 1,
          //       }).then(() => {
          //         if (i < MAX_BLOCK)
          //           return loadBlock(i + 1);
          //         return true;
          //       }).catch(e => console.log(e));;
          //     }
          //     else if (i < MAX_BLOCK)
          //       loadBlock(i + 1);
          //   });
          // }).catch(e => console.log(e));
          break;
        }
        case 'payment': {
          const address = database.ref('/users/' + tx.params.address);
          const account = database.ref('/users/' + tx.account);
          Promise.all([address.once('value', snap => {
            if (snap.exists()) {
              const balance = snap.val().balance;
              address.update({
                balance: balance + tx.params.amount,
              });
            }
          }),
          account.once('value', snap => {
            if (snap.exists()) {
              const sequence = snap.val().sequence;
              const balance2 = snap.val().balance;
              account.update({
                sequence: sequence + 1,
                balance: balance2 - tx.params.amount,
              });
            }
          })]).then(() => {
            if (i < MAX_BLOCK)
              return loadBlock(i + 1);
            return true;
          }).catch(e => console.log(e));
          break;
        }
        case 'update_account': {
          const account = database.ref('/users/' + tx.account);
          account.once('value', snap => {
            if (snap.exists()) {
              const sequence = snap.val().sequence;
              switch (tx.params.key) {
                case 'name': {
                  const name = (Buffer.from(tx.params.value).toString('utf-8'));
                  return account.update({
                    sequence: sequence + 1,
                    name,
                  }).then(() => {
                    if (i < MAX_BLOCK)
                      return loadBlock(i + 1);
                    return true;
                  }).catch(e => console.log(e));
                }
                default: break;
              }
            }
            else if (i < MAX_BLOCK)
              loadBlock(i + 1);
          });
          break;
        }
        case 'post': {
          const account = database.ref('/users/' + tx.account);
          account.once('value', snap => {
            if (snap.exists()) {
              const sequence = snap.val().sequence;
              return account.update({
                sequence: sequence + 1,
              }).then(() => {
                if (i < MAX_BLOCK)
                  return loadBlock(i + 1);
                return true;
              }).catch(e => console.log(e));
            }
            else if (i < MAX_BLOCK)
              loadBlock(i + 1);
          });
          break;
        }
        default: {
          if (i < MAX_BLOCK)
            loadBlock(i + 1);
          break;
        }
      }
    }
    else if (i < MAX_BLOCK)
      loadBlock(i + 1);
  });
}
initialize();

// let sequence = 1;
// fetch('https://komodo.forest.network/tx_search?query=%22account=%27' + key.publicKey + '%27%22', (error, meta, body) => {
//   const resp = JSON.parse(body.toString());
//   resp.result.txs.map(tx => {
//     //Từng transaction;
//     const txdecode = decode(Buffer.from(tx.tx, 'base64'));
//     if (txdecode.account === key.publicKey)
//       sequence++;
//     return tx;
//   });
// });
// // Create and Deploy Your First Cloud Functions
// // https://firebase.google.com/docs/functions/write-firebase-functions
//

app.use(bodyParser.json());
app.use(bodyParser.urlencoded());
app.post('/register', (req, res) => {
  const publicKey = req.body.publicKey;
  const data = database.ref('/users/' + publicKey);
  return data.once('value', snap => {
    if (!snap.exists()) {
      const tx = {
        version: 1,
        sequence: sequence,
        account: key.publicKey,
        operation: 'create_account',
        memo: Buffer.alloc(0),
        params: {
          address: publicKey,
        },
      }
      sign(tx, key.privateKey);
      const etx = encode(tx).toString('hex');
      return fetch("https://komodo.forest.network/broadcast_tx_commit?tx=0x" + etx, (error, meta, body) => {
        return data.set({
          balance: 0,
          energy: 0,
          sequence: 0,
        }).then(snapshot => {
          return res.status(200).send('Success');
        });
      });
    }
    else
      return res.status(400).send('User is exist');
  });
});

app.get('/getInfo/:key', (req, res) => {
  const publicKey = req.params.key;
  const data = database.ref('/users/' + publicKey);
  return data.once('value', snap => {
    if (snap.exists()) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(200).send(snap.val());
    }
    else
      return res.status(400).send('User is not exist');
  });
});

app.post('/payment', (req, res) => {
  const account = req.body.account;
  const params = req.body.params;
  const signature = req.body.signature;
  const data = database.ref('/users/' + account);
  return data.once('value', snap => {
    if (snap.exists()) {
      const sequence = snap.val().sequence;
      const tx = {
        version: 1,
        operation: 'payment',
        memo: Buffer.alloc(0),
        params,
        sequence,
        signature,
      }
      sign(tx, 'SCEYK747IB4V5VMMU6562UWT6SXRF6TRQCF474WLIXMHXNYTHDNGXZUY');
      const etx = encode(tx).toString('hex');
      res.send(tx.signature);
    }
    else
      return res.status(400).send('User is not exist');
  });
});

app.post('/updateName', (req, res) => {
  const account = req.body.account;
  const name = req.body.name;
  const signature = req.body.signature;
  const data = database.ref('/users/' + account);
  return data.once('value', snap => {
    if (snap.exists()) {
      const sequence = snap.val().sequence + 1;
      const tx = {
        version: 1,
        operation: 'update_account',
        memo: Buffer.alloc(0),
        account,
        params: {
          key: 'name',
          value: Buffer.from(name.toString('utf-8')),
        },
        sequence,
        signature,
      }
      sign(tx, 'SCRODMRHQMYICWOWI7DADXOZLZDMPK34PXPYC7L6376VSXH7ODPHKUWM');
      const etx = encode(tx).toString('hex');
      return fetch("https://komodo.forest.network/broadcast_tx_commit?tx=0x" + etx, (error, meta, body) => {
        const resp = JSON.parse(body.toString())
        if (!resp.error) {
          if (!resp.result.check_tx.code)
            return data.update({
              name: name,
              sequence: sequence,
            }).then(snapshot => {
              return res.status(200).send('Success');
            });
          else
            return res.status(400).send(resp.result.check_tx);
        }
        else
          return res.status(400).send(resp.error);
      });
    }
    else
      return res.status(400).send('User is not exist');
  });
});

const port = 3000;
app.listen(port, () => console.log(`Example app listening on port ${port}!`))

// exports.api = functions.https.onRequest(app);

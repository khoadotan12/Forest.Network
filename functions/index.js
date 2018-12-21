const bodyParser = require('body-parser');
const express = require('express');
const fetch = require('node-fetch');
const app = express();

const { initialize } = require('./initialize');
initialize();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded());
app.post('/post', (req, res) => {
  const params = req.body.params;
  if (!params)
    return res.status(400).send('Invalid params');
  const body = {
    jsonrpc: '2.0',
    method: 'broadcast_tx_commit',
    params: [params],
    id: '1'
  };
  const option = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
  return fetch('https://komodo.forest.network', option).then(res => res.json())
    .then(json => res.status(200).send(json));
});

// app.post('/register', (req, res) => {
//   const account = req.body.account;
//   const params = req.body.params;
//   const signature = req.body.signature;
//   if (!signature)
//     return res.status(401).send('transaction was not signed');
//   const data = database.ref('/users/' + account);
//   return data.once('value', snap => {
//     if (!snap.exists()) {
//       const sequence = snap.val().sequence + 1;
//       const tx = {
//         version: 1,
//         sequence: sequence,
//         account,
//         operation: 'create_account',
//         memo: Buffer.alloc(0),
//         params,
//         signature,
//       };
//       const etx = encode(tx).toString('hex');
//       return fetch("https://komodo.forest.network/broadcast_tx_commit?tx=0x" + etx, (error, meta, body) => {
//         const resp = JSON.parse(body.toString())
//         if (!resp.error) {
//           if (!resp.result.check_tx.code)
//             return res.status(200).send('Success');
//           else
//             return res.status(400).send(resp.result.check_tx);
//         }
//         else
//           return res.status(400).send(resp.error);
//       });
//     }
//     else
//       return res.status(400).send('User is exist');
//   });
// });

// app.get('/getInfo/:key', (req, res) => {
//   const publicKey = req.params.key;
//   const data = database.ref('/users/' + publicKey);
//   return data.once('value', snap => {
//     if (snap.exists()) {
//       res.setHeader('Content-Type', 'application/json');
//       return res.status(200).send(snap.val());
//     }
//     else
//       return res.status(400).send('User is not exist');
//   });
// });

// app.post('/payment', (req, res) => {
//   const account = req.body.account;
//   const params = req.body.params;
//   const signature = req.body.signature;
//   if (!signature)
//     return res.status(401).send('transaction was not signed');
//   const data = database.ref('/users/' + account);
//   return data.once('value', snap => {
//     if (snap.exists()) {
//       const sequence = snap.val().sequence + 1;
//       const tx = {
//         version: 1,
//         operation: 'payment',
//         memo: Buffer.alloc(0),
//         params,
//         sequence,
//         signature,
//       }
//       const etx = encode(tx).toString('hex');
//       return fetch("https://komodo.forest.network/broadcast_tx_commit?tx=0x" + etx, (error, meta, body) => {
//         const resp = JSON.parse(body.toString())
//         console.log(resp);
//         if (!resp.error) {
//           if (!resp.result.check_tx.code)
//             return res.status(200).send('Success');
//           else
//             return res.status(400).send(resp.result.check_tx);
//         }
//         else
//           return res.status(400).send(resp.error);
//       });
//     }
//     else
//       return res.status(400).send('User is not exist');
//   });
// });

// app.post('/updateName', (req, res) => {
//   const account = req.body.account;
//   const name = req.body.name;
//   const signature = req.body.signature;
//   if (!signature)
//     return res.status(401).send('transaction was not signed');
//   const data = database.ref('/users/' + account);
//   return data.once('value', snap => {
//     if (snap.exists()) {
//       const sequence = snap.val().sequence + 1;
//       const tx = {
//         version: 1,
//         operation: 'update_account',
//         memo: Buffer.alloc(0),
//         account,
//         params: {
//           key: 'name',
//           value: Buffer.from(name.toString('utf-8')),
//         },
//         sequence,
//         signature,
//       }
//       const etx = encode(tx).toString('hex');
//       return fetch("https://komodo.forest.network/broadcast_tx_commit?tx=0x" + etx, (error, meta, body) => {
//         const resp = JSON.parse(body.toString())
//         if (!resp.error) {
//           if (!resp.result.check_tx.code)
//             return res.status(200).send('Success');
//           else
//             return res.status(400).send(resp.result.check_tx);
//         }
//         else
//           return res.status(400).send(resp.error);
//       });
//     }
//     else
//       return res.status(400).send('User is not exist');
//   });
// });

// app.post('/updatePicture', (req, res) => {
//   const account = req.body.account;
//   const picture = req.body.picture;
//   console.log(picture);
//   const signature = req.body.signature;
//   if (!signature)
//     return res.status(401).send('transaction was not signed');
//   const data = database.ref('/users/' + account);
//   return data.once('value', snap => {
//     if (snap.exists()) {
//       const sequence = snap.val().sequence + 1;
//       const tx = {
//         version: 1,
//         operation: 'update_account',
//         memo: Buffer.alloc(0),
//         account,
//         params: {
//           key: 'picture',
//           value: Buffer.from(picture, 'base64'),
//         },
//         sequence,
//         signature,
//       }
//       const etx = encode(tx).toString('hex');
//       return fetch("https://komodo.forest.network/broadcast_tx_commit?tx=0x" + etx, (error, meta, body) => {
//         const resp = JSON.parse(body.toString())
//         if (!resp.error) {
//           if (!resp.result.check_tx.code)
//             return res.status(200).send('Success');
//           else
//             return res.status(400).send(resp.result.check_tx);
//         }
//         else
//           return res.status(400).send(resp.error);
//       });
//     }
//     else
//       return res.status(400).send('User is not exist');
//   });
// });

// app.post('/post', (req, res) => {
//   const account = req.body.account;
//   const content = req.body.content;
//   const signature = req.body.signature;
//   if (!signature)
//     return res.status(401).send('transaction was not signed');
//   const data = database.ref('/users/' + account);
//   return data.once('value', snap => {
//     if (snap.exists()) {
//       const sequence = snap.val().sequence + 1;
//       const tx = {
//         version: 1,
//         operation: 'post',
//         memo: Buffer.alloc(0),
//         account,
//         params: {
//           keys: [],
//           content: Buffer.from(content.toString()),
//         },
//         sequence,
//         signature,
//       }
//       const etx = encode(tx).toString('hex');
//       return fetch("https://komodo.forest.network/broadcast_tx_commit?tx=0x" + etx, (error, meta, body) => {
//         const resp = JSON.parse(body.toString())
//         if (!resp.error) {
//           if (!resp.result.check_tx.code)
//             return res.status(200).send('Success');
//           else
//             return res.status(400).send(resp.result.check_tx);
//         }
//         else
//           return res.status(400).send(resp.error);
//       });
//     }
//     else
//       return res.status(400).send('User is not exist');
//   });
// });

app.get('/', (req, res) => {
  res.status(200).send('hello world');
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Example app listening on port ${port}!`));

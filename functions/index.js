const bodyParser = require('body-parser');
const express = require('express');
const fetch = require('node-fetch');
const app = express();
const { decode } = require('./transaction');
const { initialize } = require('./initialize');
// initialize();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded());
const admin = require('firebase-admin');
const database = admin.database();
console.log();
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
  const tx = decode(Buffer.from(params, 'base64'));
  const account = database.ref('/users/' + tx.account);
  fetch('https://komodo.forest.network', option).then(res => res.json())
    .then(json => {
      account.once('value', snap => {
        if (snap.exists()) {
          if (!json.error) {
            if (!json.result.check_tx.code)
              account.update({
                sequence: tx.sequence,
              }).then(() => res.status(200).send(json));
            else
              res.status(400).send(json)
          }
          else
            res.status(400).send(json)
        }
        else
          res.status(400).send(json);
      });
    });
});

app.get('/', (req, res) => {
  res.status(200).send('hello world');
});

const port = process.env.PORT || 3010;
app.listen(port, () => console.log(`Example app listening on port ${port}!`));

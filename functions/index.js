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

app.get('/', (req, res) => {
  res.status(200).send('hello world');
});

const port = process.env.PORT || 3010;
app.listen(port, () => console.log(`Example app listening on port ${port}!`));

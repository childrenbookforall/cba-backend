require('dotenv').config();
const { port } = require('./config/env');
const app = require('./app');

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

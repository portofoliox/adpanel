const express = require(class="str">"express");
const app = express();
app.get(class="str">"/", (req, res) => {
  res.send(class="str">"Hello World from ADPanel!");
});
const PORT = class="num">8080;
app.listen(PORT, () => {
  console.log(class="str">`Server running on http:<span class="com">//localhost:${PORT}`);
});
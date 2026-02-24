// PYJS Shell — Example JavaScript
console.log("Hello from PYJS Shell!");
console.log("Node.js version:", process.version);
console.log("Platform:", process.platform);

// Interactive example
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question("What is your name? ", (name) => {
  console.log(`Nice to meet you, ${name}!`);
  rl.close();
});

function parseArgs(argsStr) {
  const args = [];
  let currentArg = '';
  let inQuotes = false;
  let quoteChar = null;

  for (let i = 0; i < argsStr.length; i++) {
    const char = argsStr[i];

    if ((char === '"' || char === "'") && (i === 0 || argsStr[i - 1] !== '\\')) {
      if (inQuotes && char === quoteChar) {
        inQuotes = false;
        quoteChar = null;
      } else if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else {
        currentArg += char;
      }
    } else if (char === ' ' && !inQuotes) {
      if (currentArg.length > 0) {
        args.push(currentArg);
        currentArg = '';
      }
    } else {
      currentArg += char;
    }
  }

  if (currentArg.length > 0) {
    args.push(currentArg);
  }

  return args;
}

console.log(parseArgs('score --format json'));
console.log(parseArgs('fix --auto'));
console.log(parseArgs('init --dir "my folder"'));
console.log(parseArgs("commit -m 'hello world'"));

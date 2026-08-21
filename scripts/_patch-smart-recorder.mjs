import fs from 'node:fs';
const path='state.html';
let state=fs.readFileSync(path,'utf8');
const fixed=state.replaceAll('\\`','`');
if(fixed!==state)fs.writeFileSync(path,fixed);
console.log(fixed===state?'smart recorder source already clean':'smart recorder template literals fixed');

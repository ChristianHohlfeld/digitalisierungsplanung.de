import fs from 'node:fs';
const path='state.html';
const state=fs.readFileSync(path,'utf8');
const fixed=state.replaceAll('\\`','`').replaceAll('\\${','${');
if(fixed!==state)fs.writeFileSync(path,fixed);
console.log(fixed===state?'smart recorder source already clean':'smart recorder interpolations fixed');

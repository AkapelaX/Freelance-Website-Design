import fs from "fs"; import path from "path"; import { pathToFileURL } from "url";
const files=[]; const walk=d=>fs.readdirSync(d,{withFileTypes:true}).forEach(e=>{const p=path.join(d,e.name);if(e.isDirectory()&&!p.includes('node_modules'))walk(p);else if(e.isFile()&&p.endsWith('.js'))files.push(p)}); walk(process.cwd());
for(const file of files){ if(file.endsWith('app.js')){new Function(fs.readFileSync(file,'utf8'));} else await import(pathToFileURL(file)); console.log('OK',path.relative(process.cwd(),file)); }

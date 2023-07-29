import fs from 'node:fs/promises';

const records = (await fs.readFile('history.jsonm', { encoding: 'utf-8' }))
  .split('\n')
  .filter((ln) => ln.length !== 0)
  .map((ln) => JSON.parse(ln));

let output = await fs.open('history.json', 'w');
output.writeFile('[\n', { encoding: 'utf-8' });
for (let rec of records) {
  let itm = {
    timestamp: rec.time,
    fragments: Array(6).fill(null)
  };
  rec.fragments.forEach((frag) => void (itm.fragments[frag.index] = frag.url));
  output.writeFile(`\t${JSON.stringify(itm)},\n`, { encoding: 'utf-8' });
}
output.writeFile(']\n', { encoding: 'utf-8' });
output.close();

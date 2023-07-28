import path from 'node:path';
import fs from 'node:fs/promises';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch, {
  FormData,
  Headers,
  Request,
  Response
} from 'node-fetch';

const userAgent = 'Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko';
const authToken = await fs.readFile(new URL('auth-token.txt', import.meta.url), { encoding: 'utf-8' });

function getBodyObject(t) {
  return {
    "operationName": "frameHistory",
    "variables": {
      "input": {
        "actionName": "get_frame_history",
        "GetFrameHistoryMessageData": { "timestamp": t }
      }
    },
    "query": "mutation frameHistory($input: ActInput!) {\nact(input: $input) {\ndata {\n... on BasicMessage {\nid\ndata {\n... on GetFrameHistoryResponseMessageData {\nframes {\ncanvasIndex\nurl\n__typename\n}\n__typename\n}\n__typename\n}\n__typename\n}\n__typename\n}\n__typename\n}\n}"
  };
}

const proxy = new HttpsProxyAgent('http://localhost:7890');

const timeBegin = new Date('2023-07-20T13:04:18Z').getTime();
const timeEnd = new Date('2023-07-25T21:34:53Z').getTime();
const timeStep = 30 * 1000;


let output = await fs.open('history.jsonm', 'a');
let errorCount = 0;
for (let t = timeBegin; t <= timeEnd; t += timeStep) {
  let resp;
  for (let i = 0; ; ) try {
    resp = await fetch('https://gql-realtime-2.reddit.com/query', {
      agent: proxy,
      method: 'POST',
      headers: {
        'User-Agent': userAgent,
        'Authorization': `Bearer ${authToken}`,
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-site',
        'Referer': 'https://garlic-bread.reddit.com/',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(getBodyObject(t - 1)),
      referrerPolicy: 'origin-when-cross-origin',
      redirect: 'error'
    });
    break;
  } catch (err) {
    console.log(`Connection failed`);
    console.error(err);
    if (++i === 3)
      throw err;
  }
  let ro = undefined, to;
  try {
    ro = await resp.json();
    if (!resp.ok)
      throw new Error(`Request failed`);
    let refs = [];
    refs[0] = ro?.['data']?.['act']?.['data']?.[0];
    refs[1] = refs[0]?.['data']?.['frames'];
    if (refs[0] == null || refs[1] == null)
      throw new Error(`Invalid response`);
    to = { time: t, id: refs[0]['id'], fragments: [] };
    if (refs[0]['id'] == null)
      console.warn(`Bad UUID`);
    for (let ref of refs[1]) {
      if (ref == null || ref['canvasIndex'] == null || ref['url'] == null)
        throw new Error(`Invalid fragment data`);
      to.fragments.push({ index: ref['canvasIndex'], url: ref['url'] });
    }
  } catch (err) {
    errorCount++;
    console.log(`For time: ${t}`);
    console.error(err);
    if (ro !== undefined)
      console.debug(ro);
    if (errorCount >= 10)
      break;
    continue;
  }
  await output.writeFile(JSON.stringify(to) + '\n', { encoding: 'utf-8' });
}
await output.close();

import path from 'node:path';
import fs from 'node:fs/promises';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch, {
  FormData,
  Headers,
  Request,
  Response
} from 'node-fetch';

const outputFile = 'timelapse.json';

const timeStart = new Date('2023-07-20T13:04:18Z').getTime();
const timeEnd = new Date('2023-07-25T21:34:53Z').getTime();
const timeStep = 30 * 1000;

const proxy = new HttpsProxyAgent('http://localhost:7890');

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


let output = await fs.open(outputFile, 'a');
output.writeFile('[', { encoding: 'utf-8' });

let errorCount = 0;
l: for (let i = 0, t = timeStart; t <= timeEnd; i++, t += timeStep) {
  let ro = undefined, to;
  for (let j = 0; ; ) try {
    let resp = await fetch('https://gql-realtime-2.reddit.com/query', {
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

    ro = await resp.json();
    if (!resp.ok)
      throw new Error(`Request failed`);
    let refs = [];
    refs[0] = ro?.['data']?.['act']?.['data']?.[0];
    refs[1] = refs[0]?.['data']?.['frames'];
    if (refs[0] == null || refs[1] == null)
      throw new Error(`Invalid response`);

    to = {
      timestamp: t,
      fragments: Array(6).fill(null)
    };
    if (refs[0]['id'] == null)
      console.warn(`Bad UUID`);
    for (let ref of refs[1]) {
      if (ref == null || ref['canvasIndex'] == null || ref['url'] == null)
        throw new Error(`Invalid fragment data`);
      if (!(ref['canvasIndex'] in to.fragments))
        throw new Error(`Invalid fragment index`);
      to.fragments[ref['canvasIndex']] = ref['url'];
    }

    break;
  } catch (err) {
    j++, errorCount++;
    console.log(`For ${new Date(t).toISOString()}`);
    if (ro !== undefined)
      console.debug(ro);
    console.error(err);
    if (errorCount >= 20)
      break l;
    if (j >= 3)
      continue l;
    continue;
  }

  let str = (i === 0 ? '' : ',') + `\n\t${JSON.stringify(to)}`;
  await output.writeFile(str, { encoding: 'utf-8' });
}

output.writeFile('\n]\n', { encoding: 'utf-8' });
await output.close();

import path from 'node:path';
import timers from 'node:timers/promises';
import fs from 'node:fs/promises';
import { HttpsProxyAgent } from 'https-proxy-agent';
import fetch, { FetchError } from 'node-fetch';

const outputFile = 'timelapse.json';

const timeStart = new Date('2023-07-20T13:00:00Z').getTime();
const timeEnd = new Date('2023-07-25T21:38:36Z').getTime();
const timeStep = 15 * 1000;

const taskConcurrency = 4;

const errorRetryLimit = 3, errorAbortThreshold = 20;
const fetchErrorTimeout = 5000;

const proxy = new HttpsProxyAgent('http://localhost:7890');

const userAgent = 'Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko';
const authToken = await fs.readFile(new URL('auth-token.txt', import.meta.url), { encoding: 'utf-8' });

const getBodyObject = (t) => ({
  "operationName": "frameHistory",
  "variables": {
    "input": {
      "actionName": "get_frame_history",
      "GetFrameHistoryMessageData": { "timestamp": t }
    }
  },
  "query": "mutation frameHistory($input: ActInput!) {\nact(input: $input) {\ndata {\n... on BasicMessage {\nid\ndata {\n... on GetFrameHistoryResponseMessageData {\nframes {\ncanvasIndex\nurl\n__typename\n}\n__typename\n}\n__typename\n}\n__typename\n}\n__typename\n}\n__typename\n}\n}"
});

function extractFrameFragments(ro) {
  let refs = [];
  refs[0] = ro?.['data']?.['act']?.['data']?.[0];
  refs[1] = refs[0]?.['data']?.['frames'];
  if (refs[0] == null || refs[1] == null)
    throw new Error(`Invalid response`);

  let frags = Array(6).fill(null);
  if (refs[0]['id'] == null)
    console.warn(`Bad UUID.`);
  for (let ref of refs[1]) {
    if (ref == null || ref['canvasIndex'] == null || ref['url'] == null)
      throw new Error(`Invalid fragment data`);
    if (!(ref['canvasIndex'] in frags))
      throw new Error(`Invalid fragment index`);
    frags[ref['canvasIndex']] = ref['url'];
  }

  return frags;
}

async function requestFrameView(t, signal) {
  let ro = undefined, to;

  try {
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
      redirect: 'error',
      signal
    });

    ro = await resp.json();
    if (!resp.ok)
      throw new Error(`Request failed`);

    to = {
      timestamp: t,
      fragments: extractFrameFragments(ro)
    };

  } catch (err) {
    if (err.name === 'AbortError')
      throw err;
    console.log(`For ${new Date(t).toISOString()}`);
    if (ro !== undefined)
      console.debug(ro);
    console.error(err);
    throw err;
  }

  return to;
}

async function writeOutputJSON(recs) {
  let str = '[';
  str += recs
    .map((rec) => '\n\t' + JSON.stringify(rec))
    .join(',');
  str += '\n]\n';
  await fs.writeFile(outputFile, str, { encoding: 'utf-8' });
  console.log(`Saved ${recs.length} records.`);
}

let records = [];

console.log(`Preparing to scrape...`);
let taskSchedule = [];
for (let t = timeStart; t < timeEnd; t += timeStep) {
  taskSchedule.push({ timestamp: t, retryCount: 0 });
}

if (await fs.access(outputFile).then(() => true, (err) => false)) {
  let str = await fs.readFile(outputFile, { encoding: 'utf-8' });
  records = [...JSON.parse(str)];
  for (let rec of records) {
    let i = taskSchedule.findIndex((tsk) => tsk.timestamp === rec.timestamp);
    i !== -1 && taskSchedule.splice(i, 1);
  }
  console.log(`Loaded ${records.length} existing records.`);
}

console.log(`Scraping...`);
let taskCount = 0, taskPool = new Map();
let errorCount = 0;
let aborter = new AbortController(), signal = aborter.signal;

while (taskSchedule.length > 0) {
  let tsk = taskSchedule.shift();

  let id = taskCount++;
  let p = requestFrameView(tsk.timestamp, signal)
    .then((rec) => records.push(rec));
  p = p.finally(() => taskPool.delete(id));
  p = p.catch(async (err) => {
    if (err.name === 'AbortError')
      return;
    if (err instanceof FetchError) {
      await timers.setTimeout(fetchErrorTimeout, undefined, { signal });
    } else {
      errorCount++, tsk.retryCount++;
      if (errorCount >= errorAbortThreshold)
        throw aborter.abort(), new Error(`Aborted due to excessive errors`);
      if (tsk.retryCount >= errorRetryLimit) {
        console.warn(`Retry abandoned.`);
        return;
      }
    }
    taskSchedule.unshift(tsk);
  });

  taskPool.set(id, p);
  if (taskPool.size >= taskConcurrency) try {
    await Promise.race(taskPool.values());
  } catch (err) {
    console.error(err);
    break;
  }

  if (taskCount % 100 === 0) {
    console.log(`Checkpoint reached.`);
    await writeOutputJSON(records);
  }
}

try {
  await Promise.all(taskPool.values());
} catch (err) {
  console.error(err);
}

records.sort((a, b) => a.timestamp - b.timestamp);
await writeOutputJSON(records);
console.log(`Scraping complete.`);

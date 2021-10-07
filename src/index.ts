import 'dotenv/config';
import { info, setFailed } from '@actions/core';
import { initWebstatsGraphqlClient } from 'webstats-reporters-utils';
import { getSdk } from '../generated/graphql';
import { google } from 'googleapis';
import fetch from 'node-fetch';

const projectId = process.env?.WEBSTATS_PROJECT_ID;

if (!projectId) {
  throw new Error('Environment variable WEBSTATS_PROJECT_ID not set');
}

const googleAnalyticsEmail = process.env?.GOOGLE_ANALYTICS_EMAIL;

if (!googleAnalyticsEmail) {
  throw new Error('Environment variable GOOGLE_ANALYTICS_EMAIL not set');
}

let googleAnalyticsKey = process.env?.GOOGLE_ANALYTICS_KEY;

if (!googleAnalyticsKey) {
  throw new Error('Environment variable GOOGLE_ANALYTICS_KEY not set');
}

const googleAnalyticsViewId = process.env?.GOOGLE_ANALYTICS_VIEW_ID;

if (!googleAnalyticsViewId) {
  throw new Error('Environment variable GOOGLE_ANALYTICS_VIEW_ID not set');
}

const apiUrl = 'https://analyticsreporting.googleapis.com/v4/reports:batchGet';
const scope = 'https://www.googleapis.com/auth/analytics.readonly';
googleAnalyticsKey = googleAnalyticsKey.replace(/\\n/gm, '\n');

const jwt = new google.auth.JWT(
  googleAnalyticsEmail,
  null,
  googleAnalyticsKey,
  scope,
);

const client = initWebstatsGraphqlClient();
const webstatsSdk = getSdk(client);

async function main(): Promise<void> {
  try {
    info('Fetching data from Google Analytics');
    const data = await getGoogleAnalyticsData();

    info('Transforming Google Analytics data');
    const transformedData = transformData(data);

    info('Posting Google Analytics data to Webstats');
    await createGoogleAnalyticsStatistic(transformedData);
  } catch (e) {
    setFailed(e.message);
  }
}

main();

function convertTimeToDate(time) {
  const date = new Date(time);
  const year = date.getFullYear();
  const month = ('0' + (date.getMonth() + 1)).slice(-2);
  const day = ('0' + date.getDate()).slice(-2);

  return `${year}-${month}-${day}`;
}

const from = new Date();
from.setDate(from.getDate() - 1);
from.setHours(0, 0, 0, 0);

const to = new Date(from);
to.setHours(23, 59, 59);

const googleAnalyticsViewDate = {
  viewId: googleAnalyticsViewId,
  dateRanges: [
    {
      startDate: convertTimeToDate(from.getTime()),
      endDate: convertTimeToDate(to.getTime()),
    },
  ],
};

const body = {
  reportRequests: [
    {
      ...googleAnalyticsViewDate,
      metrics: [
        {
          expression: 'ga:pageviews',
        },
        {
          expression: 'ga:users',
        },
        {
          expression: 'ga:sessions',
        },
        {
          expression: 'ga:sessionDuration',
        },
        {
          expression: 'ga:bounceRate',
        },
      ],
      dimensions: [
        {
          name: 'ga:pagePath',
        },
      ],
    },
  ],
};

async function getGoogleAnalyticsData(): Promise<any> {
  const token = await new Promise((resolve, reject) =>
    jwt.authorize(async (error, tokens) => {
      if (error) {
        reject(new Error('Error making request to generate token'));
      } else if (!tokens.access_token) {
        reject(
          new Error(
            'Provided service account doest not have permission to generate access tokens',
          ),
        );
      }
      resolve(tokens.access_token);
    }),
  );

  if (!token) {
    return null;
  }

  const headers = {
    Authorization: 'Bearer ' + token,
  };

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  return res.json();
}

function transformData(data): Record<string, unknown> {
  data.version = '1';

  const rows = data?.reports[0]?.data?.rows;

  if (!rows) {
    setFailed('Incorrect format');
  }

  rows.forEach((row) => {
    row.startDateTime = from.getTime() / 1000;
    row.endDateTime = to.getTime() / 1000;
    row.createdAt = from.getTime() / 1000;
    row.dimension = 'day';
  });

  return data;
}

async function createGoogleAnalyticsStatistic(
  data: Record<string, unknown>,
): Promise<void> {
  await webstatsSdk.createGoogleAnalyticsStatistic({
    projectId,
    data,
  });
}

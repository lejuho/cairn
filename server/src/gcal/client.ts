import { google } from "googleapis";
import type { calendar_v3 } from "googleapis";

export type GcalListParams = {
  calendarId: string;
  syncToken?: string;
  pageToken?: string;
  timeMin?: string;
  timeMax?: string;
  singleEvents?: boolean;
};

export type GcalListResult = {
  items: calendar_v3.Schema$Event[];
  nextPageToken: string | null | undefined;
  nextSyncToken: string | null | undefined;
};

export type GcalClient = {
  list(params: GcalListParams): Promise<GcalListResult>;
};

export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export function createGcalClient(auth: OAuth2Client): GcalClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cal = google.calendar({ version: "v3", auth: auth as any });

  return {
    async list(params): Promise<GcalListResult> {
      // Build only defined fields to satisfy exactOptionalPropertyTypes.
      const apiParams: calendar_v3.Params$Resource$Events$List = {
        calendarId: params.calendarId,
        singleEvents: params.singleEvents ?? true,
        showDeleted: true
      };
      if (params.syncToken !== undefined) apiParams.syncToken = params.syncToken;
      if (params.pageToken !== undefined) apiParams.pageToken = params.pageToken;
      if (params.timeMin !== undefined) apiParams.timeMin = params.timeMin;
      if (params.timeMax !== undefined) apiParams.timeMax = params.timeMax;

      const res = await cal.events.list(apiParams);
      return {
        items: res.data.items ?? [],
        nextPageToken: res.data.nextPageToken,
        nextSyncToken: res.data.nextSyncToken
      };
    }
  };
}

export function createOAuth2Client(
  clientId: string,
  clientSecret: string,
  redirectUri = "http://localhost:0"
): OAuth2Client {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

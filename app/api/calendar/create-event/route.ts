import { cookies } from 'next/headers'
import { google } from 'googleapis'
import { supabase } from '@/lib/supabase'

export async function POST(request: Request) {
  const cookieStore = await cookies()
  const userId = cookieStore.get('hs_session')?.value

  const { title, description, start_at, end_at, location, guests } = await request.json()

  const { data: tokenRow } = await supabase
    .from('google_tokens')
    .select('*')
    .order('id', { ascending: false })
    .limit(1)
    .single()

  if (!tokenRow) {
    return Response.json({ error: 'Google Calendar not connected' }, { status: 400 })
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  )

  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token,
  })

  if (new Date(tokenRow.expires_at) < new Date()) {
    const { credentials } = await oauth2Client.refreshAccessToken()
    await supabase
      .from('google_tokens')
      .update({
        access_token: credentials.access_token,
        expires_at: credentials.expiry_date
          ? new Date(credentials.expiry_date).toISOString()
          : new Date(Date.now() + 3600 * 1000).toISOString(),
      })
      .eq('id', tokenRow.id)
    oauth2Client.setCredentials(credentials)
  }

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client })
  const gcalEvent = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary: title,
      description: description ?? undefined,
      location: location ?? undefined,
      start: { dateTime: start_at },
      end: { dateTime: end_at },
      attendees: (guests ?? []).map((g: { name: string; email: string }) => ({
        displayName: g.name,
        email: g.email,
      })),
    },
  })

  const { data: calEvent } = await supabase
    .from('calendar_events')
    .insert({
      title,
      description: description ?? null,
      start_at,
      end_at,
      location: location ?? null,
      guests: guests ?? null,
      google_event_id: gcalEvent.data.id ?? null,
      created_by: userId ?? null,
    })
    .select()
    .single()

  return Response.json(calEvent)
}

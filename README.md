# Show Cover Studio

A live-preview submission form for resident DJ shows. As the DJ fills in
the form, a canvas renders the Instagram Story / SoundCloud cover live.
On submit, the cover image + audio file are uploaded to Cloudinary, and
the show data + file URLs are POSTed to a Make.com webhook to drive the
rest of the automation (image generation, Google Drive storage, Instagram
posting, etc).

## Before deploying

Open `src/App.jsx` and replace these three placeholders near the top:

- `MAKE_WEBHOOK_URL` — your Make.com custom webhook URL
- `CLOUDINARY_CLOUD_NAME` — your Cloudinary cloud name
- `CLOUDINARY_UPLOAD_PRESET` — an UNSIGNED upload preset you create in Cloudinary settings

## Run locally

    npm install
    npm run dev

## Build for deployment

    npm install
    npm run build

This produces a `dist/` folder containing static HTML/CSS/JS — deploy that
folder to Netlify, Vercel, or any static host.

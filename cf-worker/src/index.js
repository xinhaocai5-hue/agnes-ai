addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return Response.redirect(new URL('/Agnes.html', request.url), 302);
  }
  const targetUrl = 'https://raw.githubusercontent.com/xinhaocai5-hue/agnes-ai/main' + url.pathname + url.search;
  const response = await fetch(targetUrl, {
    method: request.method,
    redirect: 'follow'
  });
  const newResponse = new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
  newResponse.headers.set('Access-Control-Allow-Origin', '*');
  // Fix Content-Type for HTML files
  if (url.pathname.endsWith('.html') || url.pathname === '/') {
    newResponse.headers.set('Content-Type', 'text/html; charset=utf-8');
  }
  return newResponse;
}

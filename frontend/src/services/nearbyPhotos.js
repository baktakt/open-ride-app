/** Read the API response without surfacing HTML or parser errors to the rider. */
export async function readNearbyPhotos(response) {
  if (!response.headers.get('content-type')?.includes('application/json')) {
    if (response.status === 404) {
      throw new Error('Nearby places is missing from the backend. Redeploy the backend with /api/nearby-photos enabled.');
    }
    throw new Error('Nearby places API is unavailable. Check that /api/nearby-photos is routed to the Open Ride backend, or configure VITE_API_BASE_URL and rebuild the frontend.');
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('Nearby places returned an invalid response. Try again shortly.');
  }
  if (!response.ok) throw new Error(data?.error || 'Nearby photos are unavailable.');
  if (!Array.isArray(data?.places)) throw new Error('Nearby places returned an invalid response. Try again shortly.');
  return data;
}

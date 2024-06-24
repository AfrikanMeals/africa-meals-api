type Coord = [number, number];

export const haversineDistance = (from: Coord, to: Coord) => {
  const toRadians = (degrees: number) => degrees * (Math.PI / 180);

  const [lon1, lat1] = from;
  const [lon2, lat2] = to;

  const R = 6371; // Radius of the Earth in kilometers

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in kilometers
};

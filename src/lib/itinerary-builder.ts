import { destinations, type WellnessDestination } from './wellness-data';

export type UserPreferences = {
  country: string;
  activities: string[];
  budget: 'comfortable' | 'premium' | 'ultra-exclusive';
  dates: { start: string; end: string }; // ISO dates
  duration: number; // days
  healthGoals?: string[];
};

export type ItineraryDay = {
  day: number;
  location: string;
  activities: { time: string; description: string; cost: number }[];
  meals: string[];
  transfers: string[];
  dailyCost: number;
};

export type Itinerary = {
  totalCost: number;
  days: ItineraryDay[];
  destinations: WellnessDestination[];
};

export function buildItinerary(preferences: UserPreferences): Itinerary {
  // Filter destinations by country, activities, budget, and availability (simplified)
  const matchingDestinations = destinations.filter(d => 
    d.country.toLowerCase() === preferences.country.toLowerCase() &&
    preferences.activities.some(a => d.wellness_services.includes(a)) &&
    d.price_range === preferences.budget &&
    d.availability.some(av => av.capacity !== 'low') // Basic availability check
  ).slice(0, 3); // Limit to 3 for itinerary

  if (matchingDestinations.length === 0) {
    throw new Error('No matching destinations found');
  }

  // Calculate duration
  const startDate = new Date(preferences.dates.start);
  const endDate = new Date(preferences.dates.end);
  const duration = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 3600 * 24));

  // Build days: Simple routing - visit one destination per few days
  const days: ItineraryDay[] = [];
  let totalCost = 0;
  const daysPerDest = Math.ceil(duration / matchingDestinations.length);

  matchingDestinations.forEach((dest, index) => {
    for (let i = 0; i < daysPerDest && days.length < duration; i++) {
      const dayNum = days.length + 1;
      const dailyActivities = preferences.activities.map((a, idx) => ({
        time: `${8 + idx * 2}:00`,
        description: `${a} session at ${dest.name}`,
        cost: 100 + Math.random() * 200, // Placeholder cost
      }));
      const dailyCost = dailyActivities.reduce((sum, a) => sum + a.cost, 0) + 200; // + accommodation
      totalCost += dailyCost;

      days.push({
        day: dayNum,
        location: `${dest.city}, ${dest.country}`,
        activities: dailyActivities,
        meals: ['Organic breakfast', 'Nutritious lunch', 'Gourmet dinner'],
        transfers: index > 0 && i === 0 ? [`Transfer from previous location`] : [],
        dailyCost,
      });
    }
  });

  // Adjust for exact duration
  while (days.length > duration) days.pop();
  while (days.length < duration) {
    days.push({ ...days[days.length - 1], day: days.length + 1 });
    totalCost += days[days.length - 1].dailyCost;
  }

  return { totalCost, days, destinations: matchingDestinations };
}

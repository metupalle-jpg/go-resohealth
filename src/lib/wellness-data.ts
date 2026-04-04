export type WellnessDestination = {
  name: string;
  country: string;
  city: string;
  type: 'resort' | 'retreat' | 'clinic';
  wellness_services: string[];
  price_range: 'comfortable' | 'premium' | 'ultra-exclusive'; // Maps to ~$1k-5k, $5k-10k, $10k+
  rating: number; // 1-5
  availability: { season: string; capacity: 'low' | 'medium' | 'high' }[]; // Seasonal
  image_url: string;
  booking_url: string;
};

export const destinations: WellnessDestination[] = [
  // Thailand
  { name: 'Kamalaya Wellness Sanctuary', country: 'Thailand', city: 'Koh Samui', type: 'resort', wellness_services: ['yoga', 'meditation', 'spa', 'detox'], price_range: 'premium', rating: 4.8, availability: [{ season: 'Winter', capacity: 'high' }, { season: 'Summer', capacity: 'medium' }], image_url: '/images/kamalaya.jpg', booking_url: 'https://kamalaya.com/book' },
  { name: 'Chiva-Som', country: 'Thailand', city: 'Hua Hin', type: 'resort', wellness_services: ['spa', 'detox', 'nutrition planning', 'mental wellness'], price_range: 'ultra-exclusive', rating: 4.9, availability: [{ season: 'All Year', capacity: 'medium' }], image_url: '/images/chivasom.jpg', booking_url: 'https://chivasom.com/book' },
  { name: 'The Sanctuary Thailand', country: 'Thailand', city: 'Koh Phangan', type: 'retreat', wellness_services: ['yoga', 'meditation', 'detox'], price_range: 'comfortable', rating: 4.5, availability: [{ season: 'Dry Season', capacity: 'high' }], image_url: '/images/sanctuary-th.jpg', booking_url: 'https://thesanctuarythailand.com/book' },
  { name: 'Absolute Sanctuary', country: 'Thailand', city: 'Koh Samui', type: 'retreat', wellness_services: ['yoga', 'detox', 'fitness'], price_range: 'premium', rating: 4.7, availability: [{ season: 'Winter', capacity: 'high' }], image_url: '/images/absolute.jpg', booking_url: 'https://absolutesanctuary.com/book' },

  // Bali (Indonesia)
  { name: 'COMO Shambhala Estate', country: 'Indonesia', city: 'Ubud, Bali', type: 'resort', wellness_services: ['yoga', 'meditation', 'ayurveda', 'spa'], price_range: 'ultra-exclusive', rating: 4.9, availability: [{ season: 'Dry Season', capacity: 'medium' }], image_url: '/images/como-bali.jpg', booking_url: 'https://comoshambhala.com/book' },
  { name: 'Fivelements Retreat', country: 'Indonesia', city: 'Ubud, Bali', type: 'retreat', wellness_services: ['meditation', 'spa', 'detox', 'nutrition planning'], price_range: 'premium', rating: 4.8, availability: [{ season: 'All Year', capacity: 'low' }], image_url: '/images/fivelements.jpg', booking_url: 'https://fivelements.com/book' },
  { name: 'The Yoga Barn', country: 'Indonesia', city: 'Ubud, Bali', type: 'retreat', wellness_services: ['yoga', 'meditation', 'mental wellness'], price_range: 'comfortable', rating: 4.6, availability: [{ season: 'Dry Season', capacity: 'high' }], image_url: '/images/yogabarn.jpg', booking_url: 'https://theyogabarn.com/book' },
  { name: 'Desa Seni', country: 'Indonesia', city: 'Canggu, Bali', type: 'resort', wellness_services: ['yoga', 'spa', 'biohacking'], price_range: 'premium', rating: 4.7, availability: [{ season: 'Summer', capacity: 'medium' }], image_url: '/images/desa-seni.jpg', booking_url: 'https://desaseni.com/book' },

  // India
  { name: 'Ananda in the Himalayas', country: 'India', city: 'Rishikesh', type: 'resort', wellness_services: ['ayurveda', 'yoga', 'meditation', 'spa'], price_range: 'premium', rating: 4.9, availability: [{ season: 'Winter', capacity: 'medium' }], image_url: '/images/ananda.jpg', booking_url: 'https://anandaspa.com/book' },
  { name: 'Somatheeram Ayurveda Resort', country: 'India', city: 'Kerala', type: 'retreat', wellness_services: ['ayurveda', 'detox', 'yoga'], price_range: 'comfortable', rating: 4.7, availability: [{ season: 'Monsoon', capacity: 'high' }], image_url: '/images/somatheeram.jpg', booking_url: 'https://somatheeram.in/book' },
  { name: 'Jiva Spa at Taj', country: 'India', city: 'Goa', type: 'resort', wellness_services: ['spa', 'ayurveda', 'mental wellness'], price_range: 'premium', rating: 4.8, availability: [{ season: 'Winter', capacity: 'high' }], image_url: '/images/jiva.jpg', booking_url: 'https://tajhotels.com/book' },
  { name: 'Vana Retreat', country: 'India', city: 'Dehradun', type: 'retreat', wellness_services: ['ayurveda', 'yoga', 'longevity screening'], price_range: 'ultra-exclusive', rating: 4.9, availability: [{ season: 'All Year', capacity: 'low' }], image_url: '/images/vana.jpg', booking_url: 'https://vana.co.in/book' },

  // Sri Lanka
  { name: 'Santani Wellness Resort', country: 'Sri Lanka', city: 'Kandy', type: 'resort', wellness_services: ['yoga', 'meditation', 'ayurveda', 'detox'], price_range: 'premium', rating: 4.8, availability: [{ season: 'Dry Season', capacity: 'medium' }], image_url: '/images/santani.jpg', booking_url: 'https://santani.lk/book' },
  { name: 'Barberyn Ayurveda Resort', country: 'Sri Lanka', city: 'Weligama', type: 'retreat', wellness_services: ['ayurveda', 'spa', 'detox'], price_range: 'comfortable', rating: 4.6, availability: [{ season: 'Winter', capacity: 'high' }], image_url: '/images/barberyn.jpg', booking_url: 'https://barberynresorts.com/book' },
  { name: 'Ulpantha Spa', country: 'Sri Lanka', city: 'Bentota', type: 'resort', wellness_services: ['spa', 'yoga', 'mental wellness'], price_range: 'premium', rating: 4.7, availability: [{ season: 'Summer', capacity: 'medium' }], image_url: '/images/ulpantha.jpg', booking_url: 'https://ulpantha.com/book' },

  // Maldives
  { name: 'Soneva Fushi Wellness', country: 'Maldives', city: 'Baa Atoll', type: 'resort', wellness_services: ['spa', 'yoga', 'detox', 'biohacking'], price_range: 'ultra-exclusive', rating: 4.9, availability: [{ season: 'Dry Season', capacity: 'low' }], image_url: '/images/soneva.jpg', booking_url: 'https://soneva.com/book' },
  { name: 'COMO Maalifushi', country: 'Maldives', city: 'Thaa Atoll', type: 'resort', wellness_services: ['yoga', 'meditation', 'spa'], price_range: 'premium', rating: 4.8, availability: [{ season: 'All Year', capacity: 'medium' }], image_url: '/images/como-maldives.jpg', booking_url: 'https://comohotels.com/book' },
  { name: 'Gili Lankanfushi', country: 'Maldives', city: 'North Male Atoll', type: 'resort', wellness_services: ['spa', 'detox', 'mental wellness'], price_range: 'ultra-exclusive', rating: 4.9, availability: [{ season: 'Winter', capacity: 'low' }], image_url: '/images/gili.jpg', booking_url: 'https://gililankanfushi.com/book' },

  // Japan
  { name: 'Amanemu', country: 'Japan', city: 'Shima', type: 'resort', wellness_services: ['onsen', 'spa', 'meditation'], price_range: 'ultra-exclusive', rating: 4.9, availability: [{ season: 'Spring', capacity: 'low' }], image_url: '/images/amanemu.jpg', booking_url: 'https://aman.com/book' },
  { name: 'Hoshinoya Karuizawa', country: 'Japan', city: 'Karuizawa', type: 'resort', wellness_services: ['meditation', 'yoga', 'mental wellness'], price_range: 'premium', rating: 4.8, availability: [{ season: 'Autumn', capacity: 'medium' }], image_url: '/images/hoshinoya.jpg', booking_url: 'https://hoshinoya.com/book' },
  { name: 'Beniya Mukayu', country: 'Japan', city: 'Yamashiro Onsen', type: 'retreat', wellness_services: ['onsen', 'spa', 'detox'], price_range: 'premium', rating: 4.7, availability: [{ season: 'Winter', capacity: 'high' }], image_url: '/images/beniya.jpg', booking_url: 'https://beniyamukayu.com/book' },

  // UAE
  { name: 'One&Only The Palm', country: 'UAE', city: 'Dubai', type: 'resort', wellness_services: ['spa', 'biohacking', 'IV therapy', 'cryotherapy'], price_range: 'ultra-exclusive', rating: 4.9, availability: [{ season: 'Winter', capacity: 'high' }], image_url: '/images/oneonly.jpg', booking_url: 'https://oneandonlyresorts.com/book' },
  { name: 'Talise Ottoman Spa', country: 'UAE', city: 'Dubai', type: 'clinic', wellness_services: ['spa', 'detox', 'longevity screening'], price_range: 'premium', rating: 4.8, availability: [{ season: 'All Year', capacity: 'medium' }], image_url: '/images/talise.jpg', booking_url: 'https://jumeirah.com/book' },
  { name: 'Emirates Palace Spa', country: 'UAE', city: 'Abu Dhabi', type: 'resort', wellness_services: ['spa', 'biohacking', 'nutrition planning'], price_range: 'ultra-exclusive', rating: 4.9, availability: [{ season: 'Winter', capacity: 'high' }], image_url: '/images/emiratespalace.jpg', booking_url: 'https://emiratespalace.com/book' },

  // Turkey
  { name: 'Richmond Nua Wellness-Spa', country: 'Turkey', city: 'Sapanca', type: 'resort', wellness_services: ['thermal baths', 'spa', 'detox'], price_range: 'premium', rating: 4.7, availability: [{ season: 'Summer', capacity: 'high' }], image_url: '/images/richmondnua.jpg', booking_url: 'https://richmondnua.com/book' },
  { name: 'D Maris Bay', country: 'Turkey', city: 'Marmaris', type: 'resort', wellness_services: ['spa', 'yoga', 'mental wellness'], price_range: 'premium', rating: 4.8, availability: [{ season: 'Summer', capacity: 'medium' }], image_url: '/images/dmaris.jpg', booking_url: 'https://dmarisbay.com/book' },
  { name: 'Cappadocia Cave Suites Spa', country: 'Turkey', city: 'Cappadocia', type: 'retreat', wellness_services: ['thermal baths', 'meditation'], price_range: 'comfortable', rating: 4.6, availability: [{ season: 'Spring', capacity: 'high' }], image_url: '/images/cappadocia.jpg', booking_url: 'https://cappadociacavesuites.com/book' },

  // Portugal
  { name: 'Six Senses Douro Valley', country: 'Portugal', city: 'Lamego', type: 'resort', wellness_services: ['spa', 'yoga', 'detox', 'biohacking'], price_range: 'ultra-exclusive', rating: 4.9, availability: [{ season: 'Summer', capacity: 'medium' }], image_url: '/images/sixsenses.jpg', booking_url: 'https://sixsenses.com/book' },
  { name: 'Vilalara Thalassa Resort', country: 'Portugal', city: 'Algarve', type: 'resort', wellness_services: ['thalassotherapy', 'spa', 'longevity treatments'], price_range: 'premium', rating: 4.8, availability: [{ season: 'Summer', capacity: 'high' }], image_url: '/images/vilalara.jpg', booking_url: 'https://vilalara.com/book' },
  { name: 'The Yeatman Spa', country: 'Portugal', city: 'Porto', type: 'clinic', wellness_services: ['spa', 'nutrition planning', 'mental wellness'], price_range: 'premium', rating: 4.7, availability: [{ season: 'All Year', capacity: 'medium' }], image_url: '/images/yeatman.jpg', booking_url: 'https://theyeatman.com/book' },

  // Costa Rica
  { name: 'The Retreat Costa Rica', country: 'Costa Rica', city: 'Atenas', type: 'retreat', wellness_services: ['yoga', 'meditation', 'detox', 'nutrition planning'], price_range: 'premium', rating: 4.8, availability: [{ season: 'Dry Season', capacity: 'medium' }], image_url: '/images/theretreatcr.jpg', booking_url: 'https://theretreatcostarica.com/book' },
  { name: 'Art of Living Retreat Center', country: 'Costa Rica', city: 'Puntarenas', type: 'retreat', wellness_services: ['yoga', 'meditation', 'ayurveda'], price_range: 'comfortable', rating: 4.6, availability: [{ season: 'Winter', capacity: 'high' }], image_url: '/images/artoflivingcr.jpg', booking_url: 'https://artofliving.org/book' },
  { name: 'Nayara Springs', country: 'Costa Rica', city: 'Arenal', type: 'resort', wellness_services: ['spa', 'yoga', 'biohacking'], price_range: 'ultra-exclusive', rating: 4.9, availability: [{ season: 'Dry Season', capacity: 'low' }], image_url: '/images/nayara.jpg', booking_url: 'https://nayarasprings.com/book' },
  { name: 'Harmony Hotel', country: 'Costa Rica', city: 'Nosara', type: 'resort', wellness_services: ['yoga', 'surf wellness', 'mental wellness'], price_range: 'premium', rating: 4.7, availability: [{ season: 'Summer', capacity: 'medium' }], image_url: '/images/harmony.jpg', booking_url: 'https://harmonyhotel.com/book' },
];

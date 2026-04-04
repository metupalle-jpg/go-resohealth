import { motion } from 'framer-motion';
import { Star, DollarSign } from 'lucide-react';

type DestinationProps = {
  destination: {
    name: string;
    country: string;
    city: string;
    type: string;
    wellness_services: string[];
    price_range: string;
    rating: number;
    image_url: string;
    booking_url: string;
  };
};

export function DestinationCard({ destination }: DestinationProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="relative rounded-xl overflow-hidden mb-4"
    >
      <img src={destination.image_url} alt={destination.name} className="w-full h-48 object-cover" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
      <div className="absolute bottom-0 p-4 text-white">
        <h3 className="text-xl font-bold">{destination.name}</h3>
        <p>{destination.city}, {destination.country} - {destination.type}</p>
        <div className="flex items-center gap-2 mt-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star key={i} fill={i < Math.floor(destination.rating) ? 'yellow' : 'none'} stroke="yellow" size={16} />
          ))}
          <span>{destination.rating}</span>
          <DollarSign size={16} />
          <span>{destination.price_range}</span>
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          {destination.wellness_services.map(s => (
            <span key={s} className="bg-white/20 px-2 py-1 rounded-full text-sm">{s}</span>
          ))}
        </div>
        <div className="flex gap-4 mt-4">
          <button className="bg-indigo-500 px-4 py-2 rounded-lg">Explore</button>
          <a href={destination.booking_url} className="bg-green-500 px-4 py-2 rounded-lg">Add to Itinerary</a>
        </div>
      </div>
    </motion.div>
  );
}

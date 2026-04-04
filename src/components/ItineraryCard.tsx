import { motion } from 'framer-motion';
import { MapPin, DollarSign } from 'lucide-react';

type ItineraryDayProps = {
  day: {
    day: number;
    location: string;
    activities: { time: string; description: string; cost: number }[];
    meals: string[];
    transfers: string[];
    dailyCost: number;
  };
};

export function ItineraryCard({ day }: ItineraryDayProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-white/10 backdrop-blur-md rounded-xl p-6 mb-4"
    >
      <h2 className="text-2xl font-bold mb-4">Day {day.day}: {day.location}</h2>
      <div className="space-y-4">
        {day.activities.map((act, idx) => (
          <div key={idx} className="flex items-center gap-4">
            <div className="w-16 text-right">{act.time}</div>
            <div className="flex-1">{act.description}</div>
            <div>${act.cost}</div>
          </div>
        ))}
        <div>
          <h3 className="font-semibold">Meals</h3>
          <ul className="list-disc pl-5">{day.meals.map(m => <li key={m}>{m}</li>)}</ul>
        </div>
        {day.transfers.length > 0 && (
          <div>
            <h3 className="font-semibold">Transfers</h3>
            <ul className="list-disc pl-5">{day.transfers.map(t => <li key={t}>{t}</li>)}</ul>
          </div>
        )}
        <div className="flex justify-between items-center mt-4">
          <div className="flex items-center gap-2"><MapPin /> {day.location}</div>
          <div className="flex items-center gap-2"><DollarSign /> Daily Total: ${day.dailyCost}</div>
          <button className="bg-indigo-500 px-4 py-2 rounded-lg">Book Day</button>
        </div>
      </div>
    </motion.div>
  );
}

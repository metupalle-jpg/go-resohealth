"use client";
import React from 'react';
import { motion } from 'framer-motion';

const testimonials = [
  {
    quote: 'ResoHealth changed the way I manage my health. Their personalized approach made all the difference.',
    author: 'Jane Doe',
    title: 'Patient',
  },
  {
    quote: 'The technology behind ResoHealth is impressive. It\'s streamlined our processes and improved patient care.',
    author: 'Dr. John Smith',
    title: 'Physician',
  },
  {
    quote: 'As a healthcare provider, I can say ResoHealth offers unparalleled support and innovation.',
    author: 'Sarah Johnson',
    title: 'Healthcare Administrator',
  },
];

const Testimonials: React.FC = () => {
  return (
    <div className="py-16 bg-gray-50 sm:py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center">
          <h2 className="text-base font-semibold text-blue-600 tracking-wide uppercase">Testimonials</h2>
          <p className="mt-1 text-4xl font-extrabold text-gray-900 sm:text-5xl sm:tracking-tight lg:text-5xl">
            Loved by Patients & Providers
          </p>
          <p className="max-w-xl mt-5 mx-auto text-xl text-gray-500">
            See what our users have to say about their experience with ResoHealth.
          </p>
        </div>
        <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {testimonials.map((testimonial, index) => (
            <motion.div
              key={testimonial.author}
              className="bg-white rounded-lg shadow p-6"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.2, duration: 0.5 }}
              whileHover={{ scale: 1.02 }}
            >
              <p className="text-gray-600 italic mb-4">“{testimonial.quote}”</p>
              <div className="flex items-center mt-4">
                <div className="flex-shrink-0 h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold">
                  {testimonial.author.charAt(0)}
                </div>
                <div className="ml-4">
                  <p className="text-gray-900 font-medium">{testimonial.author}</p>
                  <p className="text-gray-500 text-sm">{testimonial.title}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Testimonials;

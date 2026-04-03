"use client";
import React from 'react';

const Footer: React.FC = () => {
  return (
    <footer className="bg-gray-800 text-white py-10">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-8">
        <div>
          <h3 className="text-lg font-semibold mb-4">ResoHealth</h3>
          <p className="text-gray-300">Transforming healthcare with innovative solutions for a better tomorrow.</p>
        </div>
        <div>
          <h3 className="text-lg font-semibold mb-4">Products</h3>
          <ul className="space-y-2 text-gray-300">
            <li><a href="#" className="hover:text-white">Personal Care</a></li>
            <li><a href="#" className="hover:text-white">Diagnostics</a></li>
            <li><a href="#" className="hover:text-white">Telehealth</a></li>
            <li><a href="#" className="hover:text-white">Wellness</a></li>
          </ul>
        </div>
        <div>
          <h3 className="text-lg font-semibold mb-4">Company</h3>
          <ul className="space-y-2 text-gray-300">
            <li><a href="#" className="hover:text-white">About Us</a></li>
            <li><a href="#" className="hover:text-white">Careers</a></li>
            <li><a href="#" className="hover:text-white">Press</a></li>
            <li><a href="#" className="hover:text-white">Blog</a></li>
          </ul>
        </div>
        <div>
          <h3 className="text-lg font-semibold mb-4">Connect</h3>
          <ul className="space-y-2 text-gray-300">
            <li><a href="#" className="hover:text-white">Contact</a></li>
            <li><a href="#" className="hover:text-white">Support</a></li>
            <li><a href="#" className="hover:text-white">FAQ</a></li>
            <li><a href="#" className="hover:text-white">Community</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-gray-700 mt-10 pt-6 text-center text-gray-400">
        <p>&copy; 2026 ResoHealth. All rights reserved.</p>
      </div>
    </footer>
  );
};

export default Footer;

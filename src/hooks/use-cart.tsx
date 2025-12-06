'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface CartItem {
  id: string; // Unique ID for the cart item, e.g., timestamp
  date: string; // 'yyyy-MM-dd'
  startTime: string; // 'HH:mm'
  endTime: string; // 'HH:mm'
  duration: number;
  cost: number;
  roomName: string;
  roomId: string;
  isSolo: boolean;
  originalCost: number;
  isVip: boolean;
}

interface CartContextType {
  cart: CartItem[];
  addToCart: (item: CartItem) => void;
  removeFromCart: (itemId: string) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

export const CartProvider = ({ children }: { children: ReactNode }) => {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load cart from localStorage on initial render
  useEffect(() => {
    try {
      const storedCart = localStorage.getItem('shoppingCart');
      if (storedCart) {
        setCart(JSON.parse(storedCart));
      }
    } catch (error) {
      console.error('Could not load cart from localStorage', error);
      localStorage.removeItem('shoppingCart');
    } finally {
        setIsLoaded(true);
    }
  }, []);

  // Save cart to localStorage whenever it changes
  useEffect(() => {
    if (isLoaded) {
        try {
            localStorage.setItem('shoppingCart', JSON.stringify(cart));
        } catch (error) {
            console.error('Could not save cart to localStorage', error);
        }
    }
  }, [cart, isLoaded]);

  const addToCart = (item: CartItem) => {
    setCart((prevCart) => [...prevCart, item]);
  };

  const removeFromCart = (itemId: string) => {
    setCart((prevCart) => prevCart.filter((item) => item.id !== itemId));
  };

  const clearCart = () => {
    setCart([]);
  };

  return (
    <CartContext.Provider value={{ cart, addToCart, removeFromCart, clearCart }}>
      {children}
    </CartContext.Provider>
  );
};

export const useCart = () => {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
};

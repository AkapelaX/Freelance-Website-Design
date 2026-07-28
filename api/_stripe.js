"use strict";

const Stripe = require("stripe");
const { requiredEnv } = require("./_utils");

let stripe;

function getStripe() {
  requiredEnv(["STRIPE_SECRET_KEY"]);
  if (!stripe) {
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-06-30.basil"
    });
  }
  return stripe;
}

const PRICE_ENV = {
  starter: {
    subscription: "STRIPE_PRICE_STARTER_ANNUAL",
    buyout: "STRIPE_PRICE_STARTER_BUYOUT"
  },
  professional: {
    subscription: "STRIPE_PRICE_PROFESSIONAL_ANNUAL",
    buyout: "STRIPE_PRICE_PROFESSIONAL_BUYOUT"
  },
  advanced: {
    subscription: "STRIPE_PRICE_ADVANCED_ANNUAL",
    buyout: "STRIPE_PRICE_ADVANCED_BUYOUT"
  }
};

function priceFor(plan, type) {
  const envName = PRICE_ENV[plan]?.[type];
  if (!envName || !process.env[envName]) {
    const error = new Error(`Stripe price is not configured for ${plan} ${type}`);
    error.status = 400;
    throw error;
  }
  return process.env[envName];
}

module.exports = { getStripe, priceFor };

import { CATALOG } from '@modules/offers/offers.catalog';
import { Offer } from '@tokenizer/shared/types';

describe('CATALOG', () => {
  it.each(Object.values(Offer))(
    'displays exactly one price for %s',
    (offer) => {
      const displayed = CATALOG[offer].prices.filter(
        ({ displayed }) => displayed,
      );

      expect(displayed).toHaveLength(1);
    },
  );
});

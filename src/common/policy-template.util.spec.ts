import {
  interpolatePolicyFields,
  interpolatePolicyTemplate,
} from './policy-template.util';

describe('policy-template.util', () => {
  it('replaces known placeholders', () => {
    expect(
      interpolatePolicyTemplate('Contact: {{supportEmail}}', {
        supportEmail: 'help@example.com',
      }),
    ).toBe('Contact: help@example.com');
  });

  it('is case-insensitive for keys', () => {
    expect(
      interpolatePolicyTemplate('{{TradeName}}', { tradename: 'Wise Eat' }),
    ).toBe('Wise Eat');
  });

  it('leaves unknown placeholders empty', () => {
    expect(interpolatePolicyTemplate('{{missing}}', {})).toBe('');
  });

  it('interpolates nested policy fields', () => {
    const out = interpolatePolicyFields(
      {
        title: '{{tradeName}}',
        description: '',
        sections: [{ title: 'S', htmlContent: '<p>{{supportEmail}}</p>' }],
      },
      { tradeName: 'Wise Eat', supportEmail: 'a@b.com' },
    );
    expect(out.title).toBe('Wise Eat');
    expect(out.sections?.[0]?.htmlContent).toBe('<p>a@b.com</p>');
  });
});

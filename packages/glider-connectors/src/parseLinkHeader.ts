// https://github.com/sindresorhus/got/blob/main/source/core/parse-link-header.ts

// MIT License
//
// Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (sindresorhus.com)
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

export default function parseLinkHeader(link: string) {
  const parsed = [];

  const items = link.split(',');

  for (const item of items) {
    // https://tools.ietf.org/html/rfc5988#section-5
    const [rawUriReference, ...rawLinkParameters] = item.split(';') as [
      string,
      ...string[]
    ];
    const trimmedUriReference = rawUriReference.trim();

    // eslint-disable-next-line @typescript-eslint/prefer-string-starts-ends-with
    if (
      trimmedUriReference[0] !== '<' ||
      trimmedUriReference[trimmedUriReference.length - 1] !== '>'
    ) {
      throw new Error(
        `Invalid format of the Link header reference: ${trimmedUriReference}`
      );
    }

    const reference = trimmedUriReference.slice(1, -1);
    const parameters: Record<string, string> = {};

    if (rawLinkParameters.length === 0) {
      throw new Error(
        `Unexpected end of Link header parameters: ${rawLinkParameters.join(
          ';'
        )}`
      );
    }

    for (const rawParameter of rawLinkParameters) {
      const trimmedRawParameter = rawParameter.trim();
      const center = trimmedRawParameter.indexOf('=');

      if (center === -1) {
        throw new Error(`Failed to parse Link header: ${link}`);
      }

      const name = trimmedRawParameter.slice(0, center).trim();
      const value = trimmedRawParameter.slice(center + 1).trim();

      parameters[name] = value;
    }

    parsed.push({
      reference,
      parameters,
    });
  }

  return parsed;
}

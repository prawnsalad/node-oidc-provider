'use strict';

const {
  provider, agent, wrap
} = require('../test_helper')(__dirname);
const JWT = require('../../lib/helpers/jwt');
const sinon = require('sinon');
const nock = require('nock');
const { expect } = require('chai');
const { parse } = require('url');

const route = '/auth';

provider.setupClient();
provider.setupClient({
  client_id: 'client-with-HS-sig',
  client_secret: 'atleast32byteslongforHS256mmkay?',
  request_object_signing_alg: 'HS256',
  redirect_uris: ['https://client.example.com/cb'],
});
provider.setupCerts();

['get', 'post'].forEach((verb) => {
  describe(`${route} ${verb} passing request parameters in request_uri`, function () {
    before(agent.login);
    after(agent.logout);

    it('works with signed by none', function () {
      const key = provider.Client.find('client-with-HS-sig').keystore.get('clientSecret');
      return JWT.sign({
        client_id: 'client-with-HS-sig',
        response_type: 'code',
        redirect_uri: 'https://client.example.com/cb'
      }, key, 'HS256').then((request) => {
        nock('https://client.example.com').get('/request').reply(200, request);
        return wrap({
          agent,
          route,
          verb,
          auth: {
            request_uri: 'https://client.example.com/request',
            scope: 'openid',
            client_id: 'client-with-HS-sig',
            response_type: 'code'
          }
        })
        .expect(302)
        .expect(function (response) {
          const expected = parse('https://client.example.com/cb', true);
          const actual = parse(response.headers.location, true);
          ['protocol', 'host', 'pathname'].forEach((attr) => {
            expect(actual[attr]).to.equal(expected[attr]);
          });
          expect(actual.query).to.have.property('code');
        });
      });
    });

    it('works with signed by an actual alg', function () {
      return JWT.sign({
        client_id: 'client',
        response_type: 'code',
        redirect_uri: 'https://client.example.com/cb'
      }, null, 'none').then((request) => {
        nock('https://client.example.com')
          .get('/request')
          .reply(200, request);

        return wrap({
          agent,
          route,
          verb,
          auth: {
            request_uri: 'https://client.example.com/request',
            scope: 'openid',
            client_id: 'client',
            response_type: 'code'
          }
        })
        .expect(302)
        .expect(function (response) {
          const expected = parse('https://client.example.com/cb', true);
          const actual = parse(response.headers.location, true);
          ['protocol', 'host', 'pathname'].forEach((attr) => {
            expect(actual[attr]).to.equal(expected[attr]);
          });
          expect(actual.query).to.have.property('code');
        });
      });
    });

    it('doesnt allow too long request_uris', function () {
      const spy = sinon.spy();
      provider.once('authentication.error', spy);

      return wrap({
        agent,
        route,
        verb,
        auth: {
          request_uri: 'https://veeeeryloong.com/uri#Lorem&Ipsum&is&simply&dummy&text&of&the&printing&and&typesetting&industry.&Lorem&Ipsum&has&been&the&industrys&standard&dummy&text&ever&since&the&1500s,&when&an&unknown&printer&took&a&galley&of&type&and&scrambled&it&to&make&a&type&specimen&book.&It&has&survived&not&only&five&centuries,&but&also&the&leap&into&electronic&typesetting,&remaining&essentially&unchanged.&It&was&popularised&in&the&1960s&with&the&release&of&Letraset&sheets&containing&Lorem&Ipsum&passages,&and&more&recently&with&desktop&publishing&software&like&Aldus&PageMaker&including&versions&of&Lorem&Ipsum',
          scope: 'openid',
          client_id: 'client',
          response_type: 'code'
        }
      })
      .expect(200)
      .expect(function () {
        expect(spy.calledOnce).to.be.true;
        expect(spy.args[0][0]).to.have.property('message', 'invalid_request_uri');
        expect(spy.args[0][0]).to.have.property('error_description',
          'the request_uri MUST NOT exceed 512 characters');
      });
    });

    it('doesnt allow http', function () {
      const spy = sinon.spy();
      provider.once('authentication.error', spy);

      return wrap({
        agent,
        route,
        verb,
        auth: {
          request_uri: 'http://insecure.com',
          scope: 'openid',
          client_id: 'client',
          response_type: 'code'
        }
      })
      .expect(200)
      .expect(function () {
        expect(spy.calledOnce).to.be.true;
        expect(spy.args[0][0]).to.have.property('message', 'invalid_request_uri');
        expect(spy.args[0][0]).to.have.property('error_description',
          'request_uri must use https scheme');
      });
    });

    it('doesnt allow slow requests (socket delay)', function () {
      const spy = sinon.spy();
      provider.once('authentication.error', spy);

      nock('https://client.example.com')
        .get('/request')
        .socketDelay(1600)
        .reply(200);

      return wrap({
        agent,
        route,
        verb,
        auth: {
          request_uri: 'https://client.example.com/request',
          scope: 'openid',
          client_id: 'client',
          response_type: 'code'
        }
      })
      .expect(200)
      .expect(function () {
        expect(spy.calledOnce).to.be.true;
        expect(spy.args[0][0]).to.have.property('message', 'invalid_request_uri');
        expect(spy.args[0][0]).to.have.property('error_description').and.matches(/Socket timed out on request to/);
      });
    });

    it('doesnt allow slow requests (response delay)', function () {
      const spy = sinon.spy();
      provider.once('authentication.error', spy);

      nock('https://client.example.com')
        .get('/request')
        .delay(1600)
        .reply(200);

      return wrap({
        agent,
        route,
        verb,
        auth: {
          request_uri: 'https://client.example.com/request',
          scope: 'openid',
          client_id: 'client',
          response_type: 'code'
        }
      })
      .expect(200)
      .expect(function () {
        expect(spy.calledOnce).to.be.true;
        expect(spy.args[0][0]).to.have.property('message', 'invalid_request_uri');
        expect(spy.args[0][0]).to.have.property('error_description').and.matches(/Connection timed out on request to/);
      });
    });

    it('doesnt accepts 200s, rejects even on redirect', function () {
      const spy = sinon.spy();
      provider.once('authentication.error', spy);

      nock('https://client.example.com')
        .get('/request')
        .reply(302, 'redirecting', {
          location: '/someotherrequest'
        });

      return wrap({
        agent,
        route,
        verb,
        auth: {
          request_uri: 'https://client.example.com/request',
          scope: 'openid',
          client_id: 'client',
          response_type: 'code'
        }
      })
      .expect(200)
      .expect(function () {
        expect(spy.calledOnce).to.be.true;
        expect(spy.args[0][0]).to.have.property('message', 'invalid_request_uri');
        expect(spy.args[0][0]).to.have.property('error_description').and.matches(/expected 200, got 302/);
      });
    });

    it('doesnt allow request inception', function () {
      const spy = sinon.spy();
      provider.once('authentication.error', spy);

      return JWT.sign({
        client_id: 'client',
        response_type: 'code',
        request: 'request inception',
        redirect_uri: 'https://client.example.com/cb'
      }, null, 'none').then((request) => {
        nock('https://client.example.com')
          .get('/request')
          .reply(200, request);
        return wrap({
          agent,
          route,
          verb,
          auth: {
            request_uri: 'https://client.example.com/request',
            scope: 'openid',
            client_id: 'client',
            response_type: 'code'
          }
        })
        .expect(200)
        .expect(function () {
          expect(spy.calledOnce).to.be.true;
          expect(spy.args[0][0]).to.have.property('message', 'invalid_request_object');
          expect(spy.args[0][0]).to.have.property('error_description',
            'request object must not contain request or request_uri properties');
        });
      });
    });

    it('doesnt allow requestUri inception', function () {
      const spy = sinon.spy();
      provider.once('authentication.error', spy);

      return JWT.sign({
        client_id: 'client',
        response_type: 'code',
        request_uri: 'request uri inception',
        redirect_uri: 'https://client.example.com/cb'
      }, null, 'none').then((request) => {
        nock('https://client.example.com')
          .get('/request')
          .reply(200, request);

        return wrap({
          agent,
          route,
          verb,
          auth: {
            request_uri: 'https://client.example.com/request',
            scope: 'openid',
            client_id: 'client',
            response_type: 'code'
          }
        })
        .expect(200)
        .expect(function () {
          expect(spy.calledOnce).to.be.true;
          expect(spy.args[0][0]).to.have.property('message', 'invalid_request_object');
          expect(spy.args[0][0]).to.have.property('error_description',
            'request object must not contain request or request_uri properties');
        });
      });
    });

    it('doesnt allow response_type to differ', function () {
      const spy = sinon.spy();
      provider.once('authentication.error', spy);

      return JWT.sign({
        client_id: 'client',
        response_type: 'id_token',
        redirect_uri: 'https://client.example.com/cb'
      }, null, 'none').then((request) => {
        nock('https://client.example.com')
          .get('/request')
          .reply(200, request);

        return wrap({
          agent,
          route,
          verb,
          auth: {
            request_uri: 'https://client.example.com/request',
            scope: 'openid',
            client_id: 'client',
            response_type: 'code'
          }
        })
        .expect(200)
        .expect(function () {
          expect(spy.calledOnce).to.be.true;
          expect(spy.args[0][0]).to.have.property('message', 'invalid_request_object');
          expect(spy.args[0][0]).to.have.property('error_description',
            'request response_type must equal the one in request parameters');
        });
      });
    });

    it('doesnt allow client_id to differ', function () {
      const spy = sinon.spy();
      provider.once('authentication.error', spy);

      return JWT.sign({
        client_id: 'client2',
        response_type: 'code',
        redirect_uri: 'https://client.example.com/cb'
      }, null, 'none').then((request) => {
        nock('https://client.example.com')
          .get('/request')
          .reply(200, request);

        return wrap({
          agent,
          route,
          verb,
          auth: {
            request_uri: 'https://client.example.com/request',
            scope: 'openid',
            client_id: 'client',
            response_type: 'code'
          }
        })
        .expect(200)
        .expect(function () {
          expect(spy.calledOnce).to.be.true;
          expect(spy.args[0][0]).to.have.property('message', 'invalid_request_object');
          expect(spy.args[0][0]).to.have.property('error_description',
            'request client_id must equal the one in request parameters');
        });
      });
    });

    it('handles invalid signed looklike jwts', function () {
      const spy = sinon.spy();
      provider.once('authentication.error', spy);

      nock('https://client.example.com')
        .get('/request')
        .reply(200, 'definitely.notsigned.jwt');

      return wrap({
        agent,
        route,
        verb,
        auth: {
          request_uri: 'https://client.example.com/request',
          scope: 'openid',
          client_id: 'client',
          response_type: 'code'
        }
      })
      .expect(200)
      .expect(function () {
        expect(spy.calledOnce).to.be.true;
        expect(spy.args[0][0]).to.have.property('message', 'invalid_request_object');
        expect(spy.args[0][0]).to.have.property('error_description').and.matches(
          /could not parse request_uri as valid JWT/
        );
      });
    });

    it('doesnt allow clients with predefined alg to bypass this alg', function () {
      const spy = sinon.spy();
      provider.once('authentication.error', spy);

      return JWT.sign({
        client_id: 'client-with-HS-sig',
        response_type: 'code',
        redirect_uri: 'https://client.example.com/cb'
      }, null, 'none').then((request) => {
        nock('https://client.example.com')
          .get('/request')
          .reply(200, request);

        return wrap({
          agent,
          route,
          verb,
          auth: {
            request_uri: 'https://client.example.com/request',
            scope: 'openid',
            client_id: 'client-with-HS-sig',
            response_type: 'code'
          }
        })
        .expect(200)
        .expect(function () {
          expect(spy.calledOnce).to.be.true;
          expect(spy.args[0][0]).to.have.property('message', 'invalid_request_object');
          expect(spy.args[0][0]).to.have.property('error_description',
            'the preregistered alg must be used in request or request_uri');
        });
      });
    });


    it('bad signatures will be rejected', function () {
      const spy = sinon.spy();
      provider.once('authentication.error', spy);

      const key = provider.Client.find('client-with-HS-sig').keystore.get('clientSecret');
      return JWT.sign({
        client_id: 'client',
        response_type: 'code',
        redirect_uri: 'https://client.example.com/cb'
      }, key, 'HS256').then((request) => {
        nock('https://client.example.com')
          .get('/request')
          .reply(200, request);

        return wrap({
          agent,
          route,
          verb,
          auth: {
            request_uri: 'https://client.example.com/request',
            scope: 'openid',
            client_id: 'client',
            response_type: 'code'
          }
        })
        .expect(200)
        .expect(function () {
          expect(spy.calledOnce).to.be.true;
          expect(spy.args[0][0]).to.have.property('message', 'invalid_request_object');
          expect(spy.args[0][0]).to.have.property('error_description').that.matches(
            /could not validate request object signature/
          );
        });
      });
    });
  });
});

FROM openpolicyagent/opa@sha256:46e10721113652fee1f553960cc5a0d96a01164760efc5e9423bbc1cc453b31d AS opa
FROM node@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
COPY --from=opa /opa /usr/local/bin/opa
WORKDIR /opt/ai-delivery
COPY dist ./dist
COPY policy ./policy
COPY schemas ./schemas
COPY package.json ./package.json
USER 65534:65534
ENV HOME=/tmp
ENTRYPOINT ["node", "/opt/ai-delivery/dist/src/enforcement/environment-entry.js"]
CMD ["generic-mcp"]

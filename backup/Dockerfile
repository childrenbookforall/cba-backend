FROM alpine:3.19

RUN apk add --no-cache \
    postgresql16-client \
    aws-cli

COPY backup.sh /backup.sh
RUN chmod +x /backup.sh

CMD ["/backup.sh"]

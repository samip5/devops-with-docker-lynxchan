FROM node:14.14.0-buster-slim
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y curl ffmpeg wget unzip build-essential pkg-config libavformat-dev

RUN echo "+ Starting Imagemagic download and build" && \
    cd /usr/local/src && \
    wget https://ftp.acc.umu.se/mirror/imagemagick.org/ftp/ImageMagick-6.9.12-1.tar.gz && \
    tar -xvf ImageMagick-6.9.12-1.tar.gz && cd ImageMagick-6.9.12-1 && \
    ./configure && make -j8 && make install && ldconfig


# Python dev dependencies
RUN DEBIAN_FRONTEND=noninteractive apt-get install -y zlib1g-dev libncurses5-dev libgdbm-dev libnss3-dev libssl-dev libsqlite3-dev libreadline-dev libffi-dev curl libbz2-dev && \
    cd /usr/local/src && wget https://www.python.org/ftp/python/3.8.3/Python-3.8.3.tar.xz && tar -xvf Python-3.8.3.tar.xz && cd Python-3.8.3 && \
    ./configure --enable-optimizations && make -j8 && make install


RUN echo "Version information: " && nodejs --version && npm --version && python3.8 --version 

COPY --chown=node:node . /home/node/

WORKDIR /home/node/
ENV HOME /home/node/
USER node

RUN cd src/be && npm install

CMD ["node", "src/be/boot.js"]
